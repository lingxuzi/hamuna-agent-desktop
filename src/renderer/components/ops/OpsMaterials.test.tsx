// 物料库的回归护栏。
//
// 五条不变量：
//  1. **列表读的是 ops/materials** —— 不是台账里的记录，是盘上的文件。
//  2. **首次使用不是错误** —— 目录还不存在时出空态，不是红字。
//  3. **上传落 ops/materials 并逐文件建记录** —— 只落文件不建记录，文件对
//     Agent 就是隐形的（面板看得见、台账查不到）。
//  4. **逐文件失败要露出来** —— 全被拒的一批看起来和成功一模一样。
//  5. **Agent 推测的描述带标记** —— 和人写的不分，下一轮 Agent 会把自己的猜测
//     当事实用来写脚本。

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { OpsMaterials } from './OpsMaterials';

const mocks = vi.hoisted(() => ({
  dirExpand: vi.fn(),
  copyPaths: vi.fn(),
  readFileAsBlobUrl: vi.fn(),
  dialogOpen: vi.fn(),
  upsert: vi.fn(),
}));

// 稳定的对象字面量：组件把 fileService 放进 useCallback 依赖，每次渲染返回
// 新对象会让 load 身份不停变化 → effect 循环 → 测试挂死。
const fileService = {
  dirExpand: mocks.dirExpand,
  copyPaths: mocks.copyPaths,
  readFileAsBlobUrl: mocks.readFileAsBlobUrl,
};
vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => fileService,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.dialogOpen }));
vi.mock('./opsWrite', () => ({
  opsUpsert: mocks.upsert,
  opsErrorMessage: (err: unknown) => String(err),
}));
vi.mock('@/components/Toast', () => ({ useToastOptional: () => null }));

const WORKSPACE = '/ws/sino';

function node(name: string, type: 'file' | 'dir', extra: Record<string, unknown> = {}) {
  return { id: name, name, path: `ops/materials/${name}`, type, ...extra };
}

function material(path: string, note: string, noteSource: 'user' | 'agent' | null = 'user') {
  return {
    id: `m-${path}`,
    fileName: path.split('/').pop() ?? path,
    path,
    note,
    noteSource,
    brief: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('OpsMaterials', () => {
  beforeEach(async () => {
    mocks.dirExpand.mockReset();
    mocks.copyPaths.mockReset();
    mocks.readFileAsBlobUrl.mockReset();
    mocks.dialogOpen.mockReset();
    mocks.upsert.mockReset();
    mocks.upsert.mockResolvedValue({ state: {}, id: 'x' });
    mocks.readFileAsBlobUrl.mockRejectedValue(new Error('not an image'));
    await i18n.changeLanguage('zh-CN');
  });

  it('列出 ops/materials 下的文件，目录排前面', async () => {
    mocks.dirExpand.mockResolvedValue({
      children: [node('cover.png', 'file'), node('batch', 'dir', { children: [] })],
      loaded: true,
    });

    render(<OpsMaterials workspace={WORKSPACE} materials={[]} />);

    await screen.findByText('cover.png');
    expect(mocks.dirExpand).toHaveBeenCalledWith({ path: 'ops/materials' });
    const names = screen.getAllByTitle(/^(batch|cover\.png)$/).map((el) => el.textContent);
    expect(names).toEqual(['batch', 'cover.png']);
  });

  it('目录不存在时出空态，不报错', async () => {
    mocks.dirExpand.mockRejectedValue(new Error('No such file or directory (os error 2)'));

    render(<OpsMaterials workspace={WORKSPACE} materials={[]} />);

    await screen.findByText('还没有物料。点「上传」把产品图、实拍、参考视频放进来。');
    expect(screen.queryByText(/os error 2/)).not.toBeInTheDocument();
  });

  it('上传把文件投进 ops/materials，一个文件建一条记录', async () => {
    mocks.dirExpand.mockResolvedValue({ children: [], loaded: true });
    mocks.dialogOpen.mockResolvedValue(['/tmp/a.png', '/tmp/b.mp4']);
    mocks.copyPaths.mockResolvedValue({
      success: true,
      copiedFiles: [
        { sourcePath: '/tmp/a.png', targetPath: 'ops/materials/a.png', renamed: false },
        { sourcePath: '/tmp/b.mp4', targetPath: 'ops/materials/b.mp4', renamed: false },
      ],
      errors: [],
    });

    render(<OpsMaterials workspace={WORKSPACE} materials={[]} />);
    await screen.findByText('还没有物料。点「上传」把产品图、实拍、参考视频放进来。');

    await userEvent.click(screen.getByRole('button', { name: /上传/ }));

    await waitFor(() =>
      expect(mocks.copyPaths).toHaveBeenCalledWith({
        sourcePaths: ['/tmp/a.png', '/tmp/b.mp4'],
        targetDir: 'ops/materials',
        autoRename: true,
      }),
    );
    await waitFor(() =>
      expect(mocks.upsert.mock.calls.map((call) => call[1])).toEqual([
        { kind: 'material', path: 'ops/materials/a.png' },
        { kind: 'material', path: 'ops/materials/b.mp4' },
      ]),
    );
    // 上传后重读一次（初次挂载 1 次 + 上传后 1 次）。
    await waitFor(() => expect(mocks.dirExpand).toHaveBeenCalledTimes(2));
  });

  it('逐文件失败要显示出来', async () => {
    mocks.dirExpand.mockResolvedValue({ children: [], loaded: true });
    mocks.dialogOpen.mockResolvedValue(['/etc/shadow']);
    mocks.copyPaths.mockResolvedValue({
      success: true,
      copiedFiles: [],
      errors: ['/etc/shadow: path is not readable'],
    });

    render(<OpsMaterials workspace={WORKSPACE} materials={[]} />);
    await screen.findByText('还没有物料。点「上传」把产品图、实拍、参考视频放进来。');

    await userEvent.click(screen.getByRole('button', { name: /上传/ }));

    await screen.findByText('/etc/shadow: path is not readable');
  });

  it('描述可见；Agent 推测的带标记', async () => {
    mocks.dirExpand.mockResolvedValue({
      children: [node('1.jpg', 'file'), node('2.jpg', 'file')],
      loaded: true,
    });

    render(
      <OpsMaterials
        workspace={WORKSPACE}
        materials={[
          material('ops/materials/1.jpg', '折叠桌正面'),
          material('ops/materials/2.jpg', '大概是包装盒', 'agent'),
        ]}
      />,
    );

    await screen.findByText('1.jpg');
    expect(screen.getByDisplayValue('折叠桌正面')).toBeInTheDocument();
    expect(screen.getByDisplayValue('大概是包装盒')).toBeInTheDocument();
    expect(screen.getAllByText('Agent 推测')).toHaveLength(1);
  });

  it('盘上有、台账没记录的文件也能写描述，顺手补记录', async () => {
    mocks.dirExpand.mockResolvedValue({ children: [node('old.jpg', 'file')], loaded: true });

    render(<OpsMaterials workspace={WORKSPACE} materials={[]} />);

    const input = await screen.findByLabelText('描述 old.jpg');
    await userEvent.type(input, '旧文件{Enter}');

    await waitFor(() =>
      expect(mocks.upsert).toHaveBeenCalledWith(WORKSPACE, {
        kind: 'material',
        path: 'ops/materials/old.jpg',
        note: '旧文件',
      }),
    );
  });
});
