// 方向域的主卡：一个平台一行，每行可写原话、可交给 Agent 结构化、可采纳修订。
//
// 为什么单独一个文件而不是塞进 OpsCards.tsx 的共用卡片族：其余四域的行是
// 「看一眼」的台账行，方向行是**唯一带三个动作**的行（写原话 / 交给 Agent /
// 采纳修订）。塞进共用族会让 renderRows 那个 switch 长出第三层分支。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Sparkles, X } from 'lucide-react';

import type { OpsDirectionRow, OpsDirectionView } from '../../../shared/ops-derive';
import { platformLabel } from './opsFormat';

interface DirectionActions {
  /** 正在提交（冻结按钮，避免连点写出两个修订）。 */
  busy: boolean;
  onWriteBrief: (platform: OpsDirectionRow['platform']) => void;
  /** 把这一行的原话连同运营纪律发给 Agent，让它结构化 / 提修订。 */
  onAskAgent: (row: OpsDirectionRow) => void;
  onAcceptProposal: (row: OpsDirectionRow) => void;
  onRejectProposal: (row: OpsDirectionRow) => void;
}

export interface OpsDirectionCardProps extends DirectionActions {
  view: OpsDirectionView;
}

export function OpsDirectionCard({
  view,
  busy,
  onWriteBrief,
  onAskAgent,
  onAcceptProposal,
  onRejectProposal,
}: OpsDirectionCardProps) {
  const { t } = useTranslation('chat');
  return (
    <section className="ops-card ops-c-top">
      <div className="ops-card-head">
        <h2>{t('ops.pool.direction.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.pool.direction.meta')}</span>
      </div>
      {view.pool.length === 0 ? (
        <p className="ops-empty">{t('ops.pool.direction.empty')}</p>
      ) : (
        <ol className="ops-list ops-dirs">
          {view.pool.map((row) => (
            <DirectionRow
              key={row.id}
              row={row}
              busy={busy}
              onWriteBrief={onWriteBrief}
              onAskAgent={onAskAgent}
              onAcceptProposal={onAcceptProposal}
              onRejectProposal={onRejectProposal}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function DirectionRow({
  row,
  busy,
  onWriteBrief,
  onAskAgent,
  onAcceptProposal,
  onRejectProposal,
}: DirectionActions & { row: OpsDirectionRow }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const hasBody = row.positioning !== '' || row.pillars.length > 0;
  const headline = row.positioning || row.brief || t('ops.direction.noBrief');
  // 副文本按「此刻这一行最该说的事」排：有修订就说修订理由，有原话就说原话，
  // 都没有（没定义过的平台）就说没定义 —— 不能拿 null 天数列进句子。
  const sub =
    row.proposalRationale !== null
      ? t('ops.direction.proposalSub', { reason: row.proposalRationale })
      : row.brief && row.positioning
        ? row.brief
        : row.idleDays !== null
          ? t('ops.direction.idleSub', { days: row.idleDays })
          : t('ops.direction.needBrief');

  return (
    <li className={row.hasProposal ? 'pending' : undefined}>
      <div className="ops-list-row">
        <span className="thumb" data-platform={row.platform} aria-hidden="true">
          {headline.trim().charAt(0) || '·'}
        </span>
        <span className="t">
          <button
            type="button"
            className="ops-dir-toggle"
            aria-expanded={expanded}
            disabled={!hasBody}
            onClick={() => setExpanded((v) => !v)}
          >
            <strong>{headline}</strong>
          </button>
          <small>{sub}</small>
        </span>
        <span className="n">{platformLabel(t, row.platform)}</span>
      </div>

      {expanded && hasBody && (
        <dl className="ops-dir-body">
          {row.audience && (
            <>
              <dt>{t('ops.direction.audience')}</dt>
              <dd>{row.audience}</dd>
            </>
          )}
          {row.goal && (
            <>
              <dt>{t('ops.direction.goal')}</dt>
              <dd>{row.goal}</dd>
            </>
          )}
          {row.cadence && (
            <>
              <dt>{t('ops.direction.cadence')}</dt>
              <dd>{row.cadence}</dd>
            </>
          )}
          {row.pillars.length > 0 && (
            <>
              <dt>{t('ops.direction.pillars')}</dt>
              <dd className="ops-dir-pillars">
                {row.pillars.map((pillar) => (
                  <span key={pillar} className="ops-dir-pillar">
                    {pillar}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}

      {/* 修订在等：人此刻只需要两个动作，其余按钮先让开。 */}
      {row.hasProposal ? (
        <div className="ops-dir-acts">
          <button
            type="button"
            className="ops-act solid"
            disabled={busy}
            onClick={() => onAcceptProposal(row)}
          >
            <Check aria-hidden="true" />
            {t('ops.direction.accept')}
          </button>
          <button
            type="button"
            className="ops-act"
            disabled={busy}
            onClick={() => onRejectProposal(row)}
          >
            <X aria-hidden="true" />
            {t('ops.direction.reject')}
          </button>
        </div>
      ) : (
        <div className="ops-dir-acts">
          <button
            type="button"
            className="ops-act"
            disabled={busy}
            onClick={() => onWriteBrief(row.platform)}
          >
            {row.brief ? t('ops.direction.editBrief') : t('ops.direction.writeBrief')}
          </button>
          <button
            type="button"
            className="ops-act solid"
            disabled={busy || row.brief.trim() === ''}
            onClick={() => onAskAgent(row)}
            title={row.brief.trim() === '' ? t('ops.direction.needBrief') : undefined}
          >
            <Sparkles aria-hidden="true" />
            {hasBody ? t('ops.direction.revise') : t('ops.direction.structure')}
          </button>
        </div>
      )}
    </li>
  );
}
