import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { localDate } from '../../../shared/logTime';
import OpsWizard, { type OpsWizardStep } from './OpsWizard';

// 冷启动向导的回归护栏。
//
// 四条不变量：
//  1. **登录在向导里** —— 人唯一必须亲自做的事不该藏在别处。
//  2. **只有已登录的平台才有方向** —— 平台都没登录就谈不上「这个号说什么」。
//  3. **物料落点是 skill 定的那个** —— 平面目录 `ops/materials/`，一个文件一条
//     记录；说明写成 `brief-<日期>.md`（O_EXCL 写的，撞名会变成 brief_1.md，
//     而入库的 skill 按名字找，所以名字必须唯一）。
//  4. **三步走完自动派工** —— 活不许再让人点一次「开工」；没方向就不派，
//     因为没有方向，Agent 找的对标会跑偏。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  copyPaths: vi.fn(),
  importBase64Files: vi.fn(),
  checkPaths: vi.fn(),
  dialogOpen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({
    copyPaths: mocks.copyPaths,
    importBase64Files: mocks.importBase64Files,
    checkPaths: mocks.checkPaths,
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.dialogOpen }));

const WORKSPACE = '/ws/sino';
const NOW = '2026-11-17T08:00:00.000Z';

function baseState(): OpsState {
  const base = emptyOpsState();
  return {
    ...base,
    accounts: [
      {
        id: 'acc-xhs',
        platform: 'xiaohongshu',
        displayName: '露营装备小王',
        loginState: 'success',
        lastCheckedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'acc-dy',
        platform: 'douyin',
        displayName: '',
        loginState: 'expired',
        lastCheckedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    directions: [
      {
        id: 'dir-xiaohongshu',
        platform: 'xiaohongshu',
        brief: '想让人记住我们是懂露营装备的',
        positioning: '',
        audience: '',
        pillars: [],
        goal: '',
        cadence: '',
        status: 'draft',
        proposal: null,
        createdAt: NOW,
        updatedAt: NOW,
        finalizedAt: null,
        lastTouchedBy: null,
        dispatchedAt: null,
      },
    ],
  };
}

function renderWizard(step: OpsWizardStep, state: OpsState = baseState()) {
  const onSendToAgent = vi.fn();
  const onStep = vi.fn();
  const onDone = vi.fn();
  const onDefer = vi.fn();
  // 不套 ToastProvider：运营台这一族组件一律用 `useToastOptional`，本来就能
  // 脱离 provider 渲染。套上反而会让 toast 的自动消失定时器活过测试环境，
  // 变成一条「window is not defined」的未捕获异常。
  const view = render(
    <OpsWizard
      workspace={WORKSPACE}
      state={state}
      step={step}
      onStep={onStep}
      onLogin={vi.fn()}
      onSendToAgent={onSendToAgent}
      onDone={onDone}
      onDefer={onDefer}
    />,
  );
  return { ...view, onSendToAgent, onStep, onDone, onDefer };
}

/** 找到写台账的那次 invoke。 */
function upsertCalls() {
  return mocks.invoke.mock.calls.filter((call) => call[0] === 'cmd_ops_upsert');
}

describe('冷启动向导', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.copyPaths.mockReset();
    mocks.importBase64Files.mockReset();
    mocks.checkPaths.mockReset();
    mocks.dialogOpen.mockReset();
    mocks.invoke.mockResolvedValue(baseState());
    mocks.copyPaths.mockResolvedValue({ copied: [], errors: [] });
    mocks.importBase64Files.mockResolvedValue({ success: true, files: [] });
    mocks.checkPaths.mockResolvedValue({ results: {} });
    await i18n.changeLanguage('zh-CN');
  });

  it('① 登录步列出全部七个平台', async () => {
    renderWizard('login');

    await waitFor(() =>
      expect(document.querySelectorAll('.ops-acc-card')).toHaveLength(7),
    );
  });

  it('② 只有已登录的平台才有方向输入框', async () => {
    renderWizard('direction');

    // 小红书已登录 → 有输入框；抖音已失效 → 没有。
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(1));
    expect(
      screen.getByPlaceholderText('想让人记住我们是懂露营装备的，主要讲夜间露营'),
    ).toBeInTheDocument();
  });

  it('② 方向原话失焦就写进这个工作区的台账', async () => {
    const user = userEvent.setup();
    renderWizard('direction');

    const box = await screen.findByRole('textbox');
    await user.clear(box);
    await user.type(box, '主要讲夜间露营');
    await user.tab();

    await waitFor(() => {
      const call = upsertCalls()[0];
      expect(call).toBeTruthy();
      expect(call?.[1]?.workspace).toBe(WORKSPACE);
      expect(call?.[1]?.item).toMatchObject({
        kind: 'direction',
        platform: 'xiaohongshu',
        brief: '主要讲夜间露营',
      });
    });
  });

  it('③ 投递把选中的文件拷进 ops/materials，并逐文件登记', async () => {
    const user = userEvent.setup();
    mocks.dialogOpen.mockResolvedValue(['/tmp/cover.png', '/tmp/intro.txt']);
    mocks.copyPaths.mockResolvedValue({
      success: true,
      copiedFiles: [
        { sourcePath: '/tmp/cover.png', targetPath: 'ops/materials/cover.png', renamed: false },
        { sourcePath: '/tmp/intro.txt', targetPath: 'ops/materials/intro.txt', renamed: false },
      ],
      errors: [],
    });
    mocks.checkPaths.mockResolvedValue({ results: {} });
    const { container } = renderWizard('material');

    await user.click(screen.getByRole('button', { name: '选文件' }));
    await waitFor(() => expect(screen.getByText('已选 2 个文件')).toBeInTheDocument());

    const briefBox = container.querySelector('.ops-field textarea') as HTMLTextAreaElement;
    await user.type(briefBox, '我们是露营装备品牌');
    await user.click(screen.getByRole('button', { name: '投进物料库' }));

    await waitFor(() => expect(mocks.copyPaths).toHaveBeenCalled());
    expect(mocks.copyPaths).toHaveBeenCalledWith({
      sourcePaths: ['/tmp/cover.png', '/tmp/intro.txt'],
      targetDir: 'ops/materials',
    });

    await waitFor(() => expect(mocks.importBase64Files).toHaveBeenCalled());
    const arg = mocks.importBase64Files.mock.calls[0]?.[0];
    expect(arg?.targetDir).toBe('ops/materials');
    expect(arg?.files?.[0]?.name).toMatch(/^brief-\d{4}-\d{2}-\d{2}\.md$/);
    // 中文必须按 UTF-8 编：btoa 只认 Latin-1，直接 btoa(中文) 会抛。
    const bytes = Uint8Array.from(atob(arg!.files![0]!.content), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('我们是露营装备品牌');

    // 一个文件一条记录：只落文件不建记录，Agent 查台账就查不到。
    await waitFor(() =>
      expect(
        upsertCalls()
          .map((call) => call[1]?.item)
          .filter((item: { kind?: string }) => item?.kind === 'material'),
      ).toEqual([
        { kind: 'material', path: 'ops/materials/cover.png' },
        { kind: 'material', path: 'ops/materials/intro.txt' },
      ]),
    );
  });

  it('③ 说明文件撞名就换一个 —— brief.md 撞名会变成 brief_1.md，skill 就读不到了', async () => {
    const user = userEvent.setup();
    mocks.dialogOpen.mockResolvedValue(['/tmp/cover.png']);
    mocks.copyPaths.mockResolvedValue({
      success: true,
      copiedFiles: [
        { sourcePath: '/tmp/cover.png', targetPath: 'ops/materials/cover.png', renamed: false },
      ],
      errors: [],
    });
    const today = localDate();
    mocks.checkPaths.mockResolvedValue({
      results: { [`ops/materials/brief-${today}.md`]: { exists: true, type: 'file' } },
    });
    const { container } = renderWizard('material');

    await user.click(screen.getByRole('button', { name: '选文件' }));
    await waitFor(() => expect(screen.getByText('已选 1 个文件')).toBeInTheDocument());

    const briefBox = container.querySelector('.ops-field textarea') as HTMLTextAreaElement;
    await user.type(briefBox, '说明');
    await user.click(screen.getByRole('button', { name: '投进物料库' }));

    await waitFor(() => expect(mocks.importBase64Files).toHaveBeenCalled());
    const name = mocks.importBase64Files.mock.calls[0]?.[0]?.files?.[0]?.name ?? '';
    expect(name).not.toBe(`brief-${today}.md`);
    expect(name).toMatch(new RegExp(`^brief-${today}-\\d+\\.md$`));
  });

  it('③ 走完最后一步就把活交给 Sino —— 不用人再点一次「开工」', async () => {
    const user = userEvent.setup();
    const { onSendToAgent, onDone } = renderWizard('material');

    await user.click(screen.getByRole('button', { name: '完成，交给 Sino' }));

    await waitFor(() => expect(onSendToAgent).toHaveBeenCalled());
    // 派工必须先落到台账 —— 反过来就留下一个说不清的状态：Agent 已经在整了，
    // 台账却没记下派过。
    expect(upsertCalls()[0]?.[1]?.item).toMatchObject({
      kind: 'direction',
      platform: 'xiaohongshu',
      dispatch: true,
    });
    // 原话和派工**一次写**：分成两次写就留了一个竞态窗口 —— 派工那条先落地时
    // 台账里还没有原话，Rust 会拒（"no brief to hand to the Agent"），
    // 派工整条丢掉，而人看到的只是「什么都没发生」。
    expect(upsertCalls()).toHaveLength(1);
    expect(upsertCalls()[0]?.[1]?.item).toMatchObject({
      brief: '想让人记住我们是懂露营装备的',
    });

    const message = String(onSendToAgent.mock.calls[0]?.[0]);
    expect(message).toContain('想让人记住我们是懂露营装备的');
    // 画像那几项只有人知道 —— 消息必须点名那个文件，并让 Agent 逐条来问，
    // 而不是替人编一张 22 字段的表。
    expect(message).toContain('03-USER.md');
    expect(message).toContain('语气');
    // 派出去就算走完了，不需要人再点一次「开工」。
    expect(onDone).toHaveBeenCalled();
  });

  it('没写方向就不派工 —— 没有方向，Agent 找的对标会跑偏', async () => {
    const user = userEvent.setup();
    const { onSendToAgent, onStep, onDone } = renderWizard('material', {
      ...baseState(),
      directions: [],
    });

    await user.click(screen.getByRole('button', { name: '完成，交给 Sino' }));

    await waitFor(() => expect(onStep).toHaveBeenCalledWith('direction'));
    // 派给 Agent 的是「往哪儿开工」—— 没有方向就派 = 让它空转一圈。
    expect(onSendToAgent).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('「以后再说」是向导的逃生阀：它只交出「以后别弹」，不写任何台账', async () => {
    const user = userEvent.setup();
    const { onDefer, onDone } = renderWizard('login');

    await user.click(await screen.findByRole('button', { name: '以后再说' }));

    expect(onDefer).toHaveBeenCalled();
    // 逃生阀不是「走完了」—— 两者的区别在父组件那边（记不记引导标记），
    // 这里要保证它们不是同一个回调。
    expect(onDone).not.toHaveBeenCalled();
    expect(upsertCalls()).toHaveLength(0);
  });
});
