// 评论线索视图：观众在我们自己作品下面说的话。
//
// 人在这一页只有两个动作：**标状态** 和 **删**。没有「新建线索」按钮 ——
// 线索是 Agent 从后台评论页采上来的，人手写一条没有意义（commentId 是平台
// 侧的东西，人编不出来），所以这里只做**读与处置**。
//
// 状态是三态循环（new → qualified → archived → new）：点一次往前推一格。
// 「值得跟进」是人的判断，Agent 不替人标 —— 它连自己采到的线索是不是需求都
// 还不知道。

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

import type { OpsAsset, OpsClue, OpsClueStatus } from '../../../shared/ops';
import { platformLabel } from './opsFormat';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { useToastOptional } from '@/components/Toast';

/** 状态往后推一格。循环回 new —— 归档后想捡回来，点一次就行。 */
const NEXT_STATUS: Record<OpsClueStatus, OpsClueStatus> = {
  new: 'qualified',
  qualified: 'archived',
  archived: 'new',
};

export interface OpsCluesProps {
  workspace: string;
  /** 台账里的全部线索。 */
  clues: OpsClue[];
  /** 素材清单：线索的 assetId 要翻成标题，人才知道这条评论挂在哪条内容下。 */
  assets: OpsAsset[];
  /** 删除走面板的确认框（确认框由 OpsPanel 持有）。 */
  onDelete: (clue: OpsClue) => void;
}

export function OpsClues({ workspace, clues, assets, onDelete }: OpsCluesProps) {
  const { t } = useTranslation('chat');
  const toast = useToastOptional();

  const assetTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) map.set(asset.id, asset.title);
    return map;
  }, [assets]);

  const pending = useMemo(
    () => clues.filter((clue) => clue.status === 'new').length,
    [clues],
  );

  const setStatus = useCallback(
    async (clue: OpsClue, status: OpsClueStatus) => {
      try {
        await opsUpsert(workspace, { kind: 'clue', id: clue.id, status });
      } catch (err) {
        toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
      }
    },
    [workspace, toast, t],
  );

  return (
    <section className="ops-card ops-c-clue">
      <div className="ops-card-head">
        <h2>{t('ops.clue.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.clue.summary', { count: pending })}</span>
      </div>
      <p className="ops-acc-scope">{t('ops.clue.scopeHint')}</p>

      {clues.length === 0 ? (
        <p className="ops-empty">{t('ops.clue.empty')}</p>
      ) : (
        <ol className="ops-list ops-clues">
          {clues.map((clue) => {
            const next = NEXT_STATUS[clue.status];
            const author = clue.authorName.trim() || t('ops.clue.noAuthor');
            const linked = clue.assetId
              ? t('ops.clue.asset', { name: assetTitle.get(clue.assetId) ?? clue.assetId })
              : null;
            return (
              <li key={clue.id}>
                <div className="ops-list-row editable">
                  <span className="ops-thumb" data-platform={clue.platform} aria-hidden="true">
                    {author.charAt(0) || '·'}
                  </span>
                  <span className="t">
                    <strong>{clue.content.trim() || t('ops.clue.noContent')}</strong>
                    <small>
                      {[author, platformLabel(t, clue.platform), t(`ops.clue.intent.${clue.intent}`), linked]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <button
                    type="button"
                    className={`ops-clue-status is-${clue.status}`}
                    onClick={() => void setStatus(clue, next)}
                    title={t('ops.clue.statusNext', { status: t(`ops.clue.status.${next}`) })}
                  >
                    {t(`ops.clue.status.${clue.status}`)}
                  </button>
                  <button
                    type="button"
                    className="row-edit row-del"
                    onClick={() => onDelete(clue)}
                    aria-label={t('ops.clue.delete')}
                    title={t('ops.clue.delete')}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
