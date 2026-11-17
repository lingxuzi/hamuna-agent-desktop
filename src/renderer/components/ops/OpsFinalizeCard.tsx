// 方向域的「定稿进度」卡：每个平台一行 —— 走到哪一步、卡在谁那儿、多久没动。
//
// 为什么不是分布条：方向是**一个平台一条**（store 的硬不变量），所以「每平台
// 有多少条已生效方向」永远是 0 或 1，那根条不是满的就是空的，没有信息。这张
// 卡要回答的是「这个号走到哪一步了、卡在谁那儿、多久没动」。
//
// 为什么单独一个文件而不是塞进 OpsCards.tsx 的共用卡片族：共用族里的四张卡
// 都是「同一种行」，这张卡的行有三段（平台 / 状态 / 时间），塞进去会让共用族
// 的行结构分裂。

import { useTranslation } from 'react-i18next';

import type { OpsDirectionView, OpsFinalizeRow } from '../../../shared/ops-derive';
import { platformLabel } from './opsFormat';

export function OpsFinalizeCard({ view }: { view: OpsDirectionView }) {
  const { t } = useTranslation('chat');
  return (
    <section className="ops-card ops-c-bars ops-final">
      <div className="ops-card-head">
        <h2>{t('ops.finalize.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.finalize.meta')}</span>
      </div>
      {view.finalize.length === 0 ? (
        <p className="ops-empty">{t('ops.finalize.empty')}</p>
      ) : (
        <ul className="ops-final-rows">
          {view.finalize.map((row) => (
            <li key={row.platform} data-stage={row.stage} data-pending={row.pending || undefined}>
              <span className="name">{platformLabel(t, row.platform)}</span>
              <span className="stage">
                {/* 色相放圆点，文字放墨色：12px 的绿字（--success 4.18:1）和橙字
                    （--accent 3.70:1）都过不了 AA 的 4.5:1。 */}
                <span className="stage-label">
                  <i className="dot" />
                  {t(`ops.finalize.stage.${row.stage}`)}
                </span>
                {/* 有修订在等：这是唯一一件「现在轮到你」的事，单独标出来。 */}
                {row.pending && (
                  <span className="pending">
                    <i className="dot" />
                    {t('ops.finalize.pending')}
                  </span>
                )}
              </span>
              {/* 谁在改。老记录没有这个事实（null）时留空 —— 空格子比「不知道是谁」
                  更诚实。空 span 也要在：它保住这一列的列数，右边的时间才始终对齐。 */}
              <span className="actor" data-actor={row.touchedBy ?? 'unknown'}>
                {row.touchedBy ? t(`ops.finalize.actor.${row.touchedBy}`) : ''}
              </span>
              <span className="when">{whenLabel(row, t)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function whenLabel(row: OpsFinalizeRow, t: Translate): string {
  // 等确认时，时间说的是**提议**的那一刻 —— 那才是人现在要处理的东西。
  if (row.pending && row.proposedDays !== null) {
    return row.proposedDays === 0
      ? t('ops.finalize.proposedToday')
      : t('ops.finalize.proposed', { days: row.proposedDays });
  }
  // 定过稿、且记下了定稿那一刻：说「N 天前定稿」。
  if (row.stage === 'final' && row.finalizedDays !== null) {
    return row.finalizedDays === 0
      ? t('ops.finalize.finalizedToday')
      : t('ops.finalize.finalized', { days: row.finalizedDays });
  }
  // 其余（以及定过稿但没记下时刻的老记录）：只能说「N 天前更新」——
  // `updatedAt` 是最后一次写，把它说成「定稿」是在撒谎。
  if (row.updatedDays === null) return '—';
  return row.updatedDays === 0
    ? t('ops.finalize.updatedToday')
    : t('ops.finalize.updated', { days: row.updatedDays });
}
