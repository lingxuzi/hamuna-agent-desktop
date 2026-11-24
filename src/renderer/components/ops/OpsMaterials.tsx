// 物料库：工作区 `ops/materials/` 里人投进来的原始文件 + 每个文件「这是什么」。
//
// 为什么需要这一页：台账里的素材（`assets`）是成品，Agent 做脚本时真正要翻的
// 是原料——哪张图是产品正面、哪段视频是门店实拍。文件都在盘上，但**盘上只有
// 文件名**，Agent 读不出「IMG_2043.jpg 是折叠桌」这件事，只能靠猜或反复问人。
// 描述落在台账里（`material.note`），跨会话、跨心跳都还在。
//
// 描述有两种来源，界面上必须分得开（`noteSource`）：人写的可以直接当事实用；
// Agent 扫出来的只是推测，下一轮不能拿它当依据。这不是洁癖——把推测显示成
// 事实，Agent 就会按着「这张图大概是产品图」去写脚本，然后出错的地方没人能追。
//
// 上传直接落 `ops/materials/` 并逐文件建一条台账记录：记录不建，文件就是隐形的
// ——面板看得见、Agent 查台账查不到。没记录的老文件照样列出来（以盘为准），
// 人在上面写一次描述就顺手补上了记录。
//
// 文件 IO 全部经 `useWorkspaceFileService` —— 面板里禁止裸 invoke。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { File, Film, Folder, Image as ImageIcon, Music, RefreshCw, Upload } from 'lucide-react';

import type { DirectoryTreeNode } from '../../../shared/dir-types';
import type { OpsMaterial } from '../../../shared/ops';
import { OPS_MATERIALS_RELATIVE_DIR } from '../../../shared/ops';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { useToastOptional } from '@/components/Toast';
import { opsErrorMessage, opsUpsert } from './opsWrite';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'];
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];
const AUDIO_EXTS = ['mp3', 'wav', 'aac', 'ogg', 'm4a', 'flac'];

/** 缩略图最多取这么多张。ponytail: 超了只出图标；物料上百张需要虚拟滚动时再改。 */
const THUMB_LIMIT = 60;

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isImage(node: DirectoryTreeNode): boolean {
  return node.type === 'file' && IMAGE_EXTS.includes(extOf(node.name));
}

function nodeIcon(node: DirectoryTreeNode) {
  if (node.type === 'dir') return <Folder size={15} aria-hidden="true" />;
  const ext = extOf(node.name);
  if (IMAGE_EXTS.includes(ext)) return <ImageIcon size={15} aria-hidden="true" />;
  if (VIDEO_EXTS.includes(ext)) return <Film size={15} aria-hidden="true" />;
  if (AUDIO_EXTS.includes(ext)) return <Music size={15} aria-hidden="true" />;
  return <File size={15} aria-hidden="true" />;
}

interface Row {
  node: DirectoryTreeNode;
  depth: number;
}

/**
 * `dirExpand` 一次给到 3 层，直接摊平成带深度的行，不再按目录二次请求。
 * 物料目录是平的，深度只为兜住人手工建的子目录。
 */
function flatten(nodes: DirectoryTreeNode[], depth = 0): Row[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const rows: Row[] = [];
  for (const node of sorted) {
    rows.push({ node, depth });
    if (node.type === 'dir' && node.children?.length) {
      rows.push(...flatten(node.children, depth + 1));
    }
  }
  return rows;
}

/** 目录还不存在是「还没投过物料」，不是错误 —— 首次上传会由 copyPaths 建出来。 */
function isMissingDir(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such file|not found|os error 2|不存在/i.test(msg);
}

export function OpsMaterials({
  workspace,
  materials,
}: {
  workspace: string;
  /** 台账里的物料记录。**盘是权威**：盘上有、台账没有的文件照样列出来。 */
  materials: OpsMaterial[];
}) {
  const { t } = useTranslation('chat');
  const fileService = useWorkspaceFileService(workspace);
  const toast = useToastOptional();

  const [rows, setRows] = useState<Row[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  /** blob URL 的生命周期归调用方 —— 换列表 / 卸载时必须 revoke。 */
  const revokers = useRef<Map<string, () => void>>(new Map());

  const byPath = useMemo(() => {
    const map = new Map<string, OpsMaterial>();
    // 同一路径理论上有且只有一条（store 校验唯一），重复时后写的覆盖先写的。
    for (const material of materials) map.set(material.path, material);
    return map;
  }, [materials]);

  const releaseThumbs = useCallback(() => {
    for (const revoke of revokers.current.values()) revoke();
    revokers.current.clear();
    setThumbs({});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fileService.dirExpand({ path: OPS_MATERIALS_RELATIVE_DIR });
      releaseThumbs();
      setRows(flatten(res.children ?? []));
      setTruncated(res.loaded === false);
    } catch (err) {
      releaseThumbs();
      setRows([]);
      setTruncated(false);
      if (!isMissingDir(err)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fileService, releaseThumbs]);

  useEffect(() => {
    void load();
    return releaseThumbs;
  }, [load, releaseThumbs]);

  /** 图片行的 blob URL。逐张加载、逐张失败静默降级 —— 一张坏图不该让整库报错。 */
  const imagePaths = useMemo(
    () => rows.filter((row) => isImage(row.node)).map((row) => row.node.path).slice(0, THUMB_LIMIT),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const path of imagePaths) {
        if (revokers.current.has(path)) continue;
        try {
          const handle = await fileService.readFileAsBlobUrl({ path });
          if (cancelled) {
            handle.revoke();
            continue;
          }
          revokers.current.set(path, handle.revoke);
          setThumbs((prev) => ({ ...prev, [path]: handle.blobUrl }));
        } catch {
          // 超 25MB / 非位图 / 读失败：留图标。
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileService, imagePaths]);

  /**
   * 落盘 → 建记录。**一个文件一条**：一条记录描述一个文件，合起来描述一批就
   * 又回到「Agent 不知道哪张图是哪个」。
   *
   * 建记录失败不回滚文件：文件已经在盘上、面板也列得出来，剩下的只是缺描述。
   * 但失败必须说出来 —— 只落文件不建记录，就是「面板看得见、Agent 查不到」。
   */
  const handleUpload = useCallback(async () => {
    if (uploading) return;
    setUploading(true);
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ multiple: true, directory: false });
      if (!picked) return;
      const sourcePaths = (Array.isArray(picked) ? picked : [picked]).filter(
        (p): p is string => typeof p === 'string' && p.length > 0,
      );
      if (sourcePaths.length === 0) return;
      const result = await fileService.copyPaths({
        sourcePaths,
        targetDir: OPS_MATERIALS_RELATIVE_DIR,
        autoRename: true,
      });
      const failures = [...result.errors];
      for (const file of result.copiedFiles) {
        try {
          await opsUpsert(workspace, { kind: 'material', path: file.targetPath });
        } catch (err) {
          failures.push(`${file.targetPath}: ${opsErrorMessage(err)}`);
        }
      }
      // 先重读再报错：`load()` 开头会清掉上一次的错误，反过来写上传错误会被
      // 自己刚发起的重读抹掉。
      await load();
      // 逐文件失败不中断整批，但必须让人看见：全被拒的一批看起来和成功一模一样。
      if (failures.length > 0) {
        setError(
          failures.length === 1
            ? failures[0]
            : t('ops.material.copyFailed', {
                reason: failures[0],
                count: failures.length,
              }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [fileService, load, t, uploading, workspace]);

  /**
   * 描述保存。输入框是**非受控**的：`key` 里带着台账里的现值，Agent 改过之后
   * 重渲染自然换成新值，不需要本地草稿与本地的「已保存」状态。
   *
   * 没记录的旧文件在这里顺手补上记录 —— 迁移代码不用写。
   */
  const saveNote = useCallback(
    async (path: string, previous: string, value: string) => {
      const note = value.trim();
      if (note === previous) return;
      try {
        await opsUpsert(workspace, { kind: 'material', path, note });
        toast?.success(t('ops.material.noteSaved'));
      } catch (err) {
        toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
      }
    },
    [workspace, toast, t],
  );

  return (
    <section className="ops-card ops-c-mat">
      <div className="ops-card-head">
        <h2>{t('ops.material.title')}</h2>
        <span className="ops-sp" />
        {/* 两个按钮并排：`.ops-ghost` 内边距比 `.ops-act` 小 2px，直接并排会
           一高一矮。包一层 stretch，高度由高的那个决定，窄屏改 36px 时也跟得上。 */}
        <div className="ops-mat-actions">
          <button
            type="button"
            className="ops-ghost"
            onClick={() => void load()}
            disabled={loading || uploading}
            aria-label={t('ops.material.refresh')}
            title={t('ops.material.refresh')}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ops-act solid"
            onClick={() => void handleUpload()}
            disabled={uploading}
          >
            <Upload size={14} aria-hidden="true" />
            {uploading ? t('ops.material.uploading') : t('ops.material.upload')}
          </button>
        </div>
      </div>
      <p className="ops-acc-scope">{t('ops.material.hint')}</p>

      {error && <p className="ops-mat-error">{error}</p>}

      {loading ? (
        <p className="ops-empty">{t('ops.material.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="ops-empty">{t('ops.material.empty')}</p>
      ) : (
        <>
          <ul className="ops-list ops-mat-list">
            {rows.map(({ node, depth }) => {
              const record = byPath.get(node.path);
              const note = record?.note ?? '';
              return (
                <li key={node.path}>
                  <div className="ops-mat-row" data-depth={depth}>
                    <span className="ops-mat-thumb" aria-hidden="true">
                      {thumbs[node.path] ? (
                        <img src={thumbs[node.path]} alt="" />
                      ) : (
                        nodeIcon(node)
                      )}
                    </span>
                    <span className="ops-mat-name" title={node.name}>
                      {node.name}
                    </span>
                    {record?.noteSource === 'agent' && (
                      <span className="ops-mat-tag">{t('ops.material.noteAgent')}</span>
                    )}
                  </div>
                  {node.type === 'file' && (
                    <input
                      // 现值进 key：Agent 改过描述后重渲染自动换掉输入框内容。
                      key={`${node.path}:${note}:${record?.noteSource ?? ''}`}
                      className="ops-input ops-mat-note-input"
                      defaultValue={note}
                      placeholder={t('ops.material.notePh')}
                      maxLength={200}
                      aria-label={t('ops.material.noteLabel', { name: node.name })}
                      onBlur={(e) => void saveNote(node.path, note, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {truncated && <p className="ops-mat-note">{t('ops.material.truncated')}</p>}
        </>
      )}
    </section>
  );
}
