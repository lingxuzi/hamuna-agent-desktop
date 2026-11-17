import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState, OpsTopic } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import OpsWizard, { type OpsWizardStep } from './OpsWizard';

// 冷启动向导的回归护栏。
//
// 三条不变量：
//  1. **登录在向导里** —— 人唯一必须亲自做的事不该藏在别处。
//  2. **只有已登录的平台才有方向** —— 平台都没登录就谈不上「这个号说什么」。
//  3. **物料落点是 skill 定的那个** —— `ops/inbox/<批次>/` + `brief.md`；
//     brief.md 是 O_EXCL 写的，撞名会变成 brief_1.md，而入库的 skill 只读
//     brief.md，所以批次目录必须唯一。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readPreview: vi.fn(),
  saveFile: vi.fn(),
  copyPaths: vi.fn(),
  importBase64Files: vi.fn(),
  checkPaths: vi.fn(),
  dialogOpen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({
    readPreview: mocks.readPreview,
    saveFile: mocks.saveFile,
    copyPaths: mocks.copyPaths,
    importBase64Files: mocks.importBase64Files,
    checkPaths: mocks.checkPaths,
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.dialogOpen }));

const WORKSPACE = '/ws/sino';
const NOW = '2026-11-17T08:00:00.000Z';

/** 模板里那份真实的画像文件 —— 向导要解析的正是它。 */
const PROFILE_TEMPLATE = readFileSync(
  join(process.cwd(), 'agent-templates/sino/.claude/rules/03-USER.md'),
  'utf8',
);

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

function topicFixture(): OpsTopic {
  return {
    id: 'topic-1',
    title: '新手第一次露营，最该先买哪一件装备',
    note: '装备焦虑最集中的时候',
    angle: '从「预算 2000 块」切入',
    platform: 'xiaohongshu',
    tags: [],
    status: 'idea',
    source: 'hotspot',
    sourceRefs: [],
    hotness: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function renderWizard(step: OpsWizardStep, state: OpsState = baseState()) {
  const onSendToAgent = vi.fn();
  const onStep = vi.fn();
  const onDone = vi.fn();
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
      onEditBenchmark={vi.fn()}
      onDeleteBenchmark={vi.fn()}
    />,
  );
  return { ...view, onSendToAgent, onStep, onDone };
}

/** 找到写台账的那次 invoke。 */
function upsertCalls() {
  return mocks.invoke.mock.calls.filter((call) => call[0] === 'cmd_ops_upsert');
}

describe('冷启动向导', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.readPreview.mockReset();
    mocks.saveFile.mockReset();
    mocks.copyPaths.mockReset();
    mocks.importBase64Files.mockReset();
    mocks.checkPaths.mockReset();
    mocks.dialogOpen.mockReset();
    mocks.invoke.mockResolvedValue(baseState());
    mocks.readPreview.mockResolvedValue({
      content: PROFILE_TEMPLATE,
      name: '03-USER.md',
      size: PROFILE_TEMPLATE.length,
    });
    mocks.saveFile.mockResolvedValue(undefined);
    mocks.copyPaths.mockResolvedValue({ copied: [], errors: [] });
    mocks.importBase64Files.mockResolvedValue({ imported: [] });
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

  it('③ 投递把选中的文件拷进收件箱，并写下 brief.md', async () => {
    const user = userEvent.setup();
    mocks.dialogOpen.mockResolvedValue(['/tmp/cover.png', '/tmp/intro.txt']);
    mocks.checkPaths.mockResolvedValue({
      results: { 'ops/inbox/batch-1': { exists: false, type: 'file' } },
    });
    const { container } = renderWizard('material');

    const batchInput = container.querySelector('.ops-field input') as HTMLInputElement;
    await user.clear(batchInput);
    await user.type(batchInput, 'batch-1');
    await user.click(screen.getByRole('button', { name: '选文件' }));
    await waitFor(() => expect(screen.getByText('已选 2 个文件')).toBeInTheDocument());

    const briefBox = container.querySelector('.ops-field textarea') as HTMLTextAreaElement;
    await user.type(briefBox, '我们是露营装备品牌');
    await user.click(screen.getByRole('button', { name: '投进收件箱' }));

    await waitFor(() => expect(mocks.copyPaths).toHaveBeenCalled());
    expect(mocks.copyPaths).toHaveBeenCalledWith({
      sourcePaths: ['/tmp/cover.png', '/tmp/intro.txt'],
      targetDir: 'ops/inbox/batch-1',
    });

    await waitFor(() => expect(mocks.importBase64Files).toHaveBeenCalled());
    const arg = mocks.importBase64Files.mock.calls[0]?.[0];
    expect(arg?.targetDir).toBe('ops/inbox/batch-1');
    expect(arg?.files?.[0]?.name).toBe('brief.md');
    // 中文必须按 UTF-8 编：btoa 只认 Latin-1，直接 btoa(中文) 会抛。
    const bytes = Uint8Array.from(atob(arg!.files![0]!.content), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('我们是露营装备品牌');
  });

  it('③ 批次目录撞了就换一个 —— brief.md 撞名会变成 brief_1.md，skill 就读不到了', async () => {
    const user = userEvent.setup();
    mocks.dialogOpen.mockResolvedValue(['/tmp/cover.png']);
    mocks.checkPaths.mockResolvedValue({
      results: { 'ops/inbox/batch-1': { exists: true, type: 'dir' } },
    });
    const { container } = renderWizard('material');

    const batchInput = container.querySelector('.ops-field input') as HTMLInputElement;
    await user.clear(batchInput);
    await user.type(batchInput, 'batch-1');
    await user.click(screen.getByRole('button', { name: '选文件' }));
    await waitFor(() => expect(screen.getByText('已选 1 个文件')).toBeInTheDocument());

    const briefBox = container.querySelector('.ops-field textarea') as HTMLTextAreaElement;
    await user.type(briefBox, '说明');
    await user.click(screen.getByRole('button', { name: '投进收件箱' }));

    await waitFor(() => expect(mocks.importBase64Files).toHaveBeenCalled());
    expect(mocks.importBase64Files.mock.calls[0]?.[0]?.targetDir).toBe('ops/inbox/batch-1-2');
  });

  it('④ 保存画像把改过的标签写回 03-USER.md，其余行一个不动', async () => {
    const user = userEvent.setup();
    renderWizard('profile');

    // 二十二个字段全渲染出来 —— 少一个就是模板与向导脱节了。
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(22));

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0] as HTMLElement, '露营装备小王');
    await user.click(screen.getByRole('button', { name: '保存画像' }));

    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalled());
    const arg = mocks.saveFile.mock.calls[0]?.[0];
    expect(arg?.path).toBe('.claude/rules/03-USER.md');
    // 带乐观锁：别人刚改过就写失败，而不是覆盖掉。
    expect(arg?.expectedContent).toBe(PROFILE_TEMPLATE);
    expect(arg?.content).toContain('- **账号名：** 露营装备小王');
    const before = PROFILE_TEMPLATE.split('\n');
    const after = (arg?.content as string).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual([
      '- **账号名：** 露营装备小王',
    ]);
  });

  it('④ 交给 Agent 开工：先把派工记进台账，再把方向原话交出去', async () => {
    const user = userEvent.setup();
    const { onSendToAgent } = renderWizard('profile');

    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(22));
    await user.click(screen.getByRole('button', { name: '交给 Agent 开工' }));

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
    expect(String(onSendToAgent.mock.calls[0]?.[0])).toContain('想让人记住我们是懂露营装备的');
  });

  it('⑥ 挑一条选题就把它排进计划', async () => {
    const user = userEvent.setup();
    const state = { ...baseState(), topics: [topicFixture()] };
    renderWizard('topic', state);

    await user.click(await screen.findByRole('button', { name: '选它做第一条' }));

    await waitFor(() => {
      const call = upsertCalls()[0];
      expect(call).toBeTruthy();
      expect(call?.[1]?.item).toMatchObject({
        kind: 'topic',
        id: 'topic-1',
        status: 'planned',
      });
    });
  });
});
