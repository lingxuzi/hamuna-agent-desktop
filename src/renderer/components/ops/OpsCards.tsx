import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  OpsAssetView,
  OpsDistBar,
  OpsReviewRow,
  OpsReviewView,
  OpsScheduleView,
  OpsTopicView,
} from '../../../shared/ops-derive';
import { distTotal } from '../../../shared/ops-derive';
import {
  clockTime,
  formatCompact,
  formatHotness,
  formatInteger,
  formLabel,
  platformLabel,
  shortDate,
  weekdayShort,
} from './opsFormat';

/* 四域共用的卡片族。结构只有五种：标题壳 / 分布条 / 主列表 / 深墨卡 / 要点。
   每个域换的是内容与口径，不是布局 —— 布局一域一变，窄栏摊平的 order 槽位
   就对不上了。 */

export function OpsCard({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`ops-card ${className ?? ''}`}>
      <div className="ops-card-head">
        <h2>{title}</h2>
        <span className="ops-sp" />
        {meta && <span className="ops-meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function distLabel(
  bar: OpsDistBar,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (bar.kind === 'platform') return platformLabel(t, bar.key as never);
  return t(`ops.dist.${bar.kind}.${bar.key}`);
}

export function OpsDistCard({
  view,
  className,
}: {
  view: OpsTopicView | OpsAssetView | OpsScheduleView | OpsReviewView;
  className?: string;
}) {
  const { t, i18n } = useTranslation('chat');
  // 分母写在卡头：条长是份额，光有份额是悬空的百分比 —— 「58%」的 58% 是
  // 相对于什么，得有个数在旁。这个数也让「一根条代表 1 条还是 100 条」
  // 有答案：份额 × 总数 = 这一项的绝对量。
  //
  // 没有数就不写：空态那一句「还没有可统计的数据」已经说完了，再补一句
  // 「共 0 条」是同一件事说两遍。
  const total = distTotal(view.dist);
  return (
    <OpsCard
      title={t(`ops.dist.${view.domain}.title`)}
      meta={
        total > 0
          ? t(`ops.dist.${view.domain}.meta`, { n: formatCompact(total, i18n.language) })
          : undefined
      }
      className={`ops-c-bars ${className ?? ''}`}
    >
      {view.dist.length === 0 ? (
        <p className="ops-empty">{t('ops.dist.empty')}</p>
      ) : (
        <ul className="ops-bars">
          {view.dist.map((bar) => (
            <li key={`${bar.kind}:${bar.key}`}>
              <span className="name">{distLabel(bar, t)}</span>
              {/* 分布条既有「几条」也有「多少播放」，一律走 compact：
                  小数值 compact 原样输出，大数值才缩写，不需要分支。 */}
              <span className="val">{formatCompact(bar.value, i18n.language)}</span>
              <span className="track">
                <i style={{ width: `${bar.pct}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </OpsCard>
  );
}

/** 列表首列的字牌：一个字 + 平台色点。 */
function Thumb({ platform, title }: { platform: string | null; title: string }) {
  const initial = title.trim().charAt(0) || '·';
  return (
    <span className="ops-thumb" data-platform={platform ?? undefined} aria-hidden="true">
      {initial}
    </span>
  );
}

/** 可编辑行的壳：给标题旁一个铅笔入口。排期 / 复盘行不传 onEdit，原样渲染。 */
function RowShell({
  onEdit,
  children,
}: {
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('chat');
  if (!onEdit) return <div className="ops-list-row">{children}</div>;
  return (
    <div className="ops-list-row editable">
      {children}
      {onEdit && (
        <button
          type="button"
          className="row-edit"
          onClick={onEdit}
          aria-label={t('ops.row.edit')}
          title={t('ops.row.edit')}
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function OpsPoolCard({
  view,
  className,
  onEditTopic,
  onEditAsset,
  onStartTopic,
}: {
  view: OpsTopicView | OpsAssetView | OpsScheduleView | OpsReviewView;
  className?: string;
  /** 选题 / 素材行的编辑入口。排期与复盘行的编辑入口在素材 / 复盘域。 */
  onEditTopic?: (topicId: string) => void;
  onEditAsset?: (assetId: string) => void;
  /** 选题行的「开工」入口：确认形态后直接派工生成。 */
  onStartTopic?: (topicId: string) => void;
}) {
  const { t, i18n } = useTranslation('chat');
  const head = `ops.pool.${view.domain}`;
  return (
    <OpsCard
      title={t(`${head}.title`)}
      meta={t(`${head}.meta`)}
      className={`ops-c-top ${className ?? ''}`}
    >
      {view.pool.length === 0 ? (
        <p className="ops-empty">{t(`${head}.empty`)}</p>
      ) : (
        <>
          <div className="ops-list-head">
            <span>{t(`${head}.col1`)}</span>
            <span>{t(`${head}.col2`)}</span>
          </div>
          <ol className="ops-list">
            {renderRows(view, t, i18n.language, { onEditTopic, onEditAsset, onStartTopic })}
          </ol>
        </>
      )}
    </OpsCard>
  );
}

function renderRows(
  view: OpsTopicView | OpsAssetView | OpsScheduleView | OpsReviewView,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
  handlers: {
    onEditTopic?: (topicId: string) => void;
    onEditAsset?: (assetId: string) => void;
    onStartTopic?: (topicId: string) => void;
  },
): React.ReactNode[] {
  switch (view.domain) {
    case 'topic':
      return view.pool.map((row) => (
        <li key={row.id}>
          <RowShell onEdit={handlers.onEditTopic ? () => handlers.onEditTopic?.(row.id) : undefined}>
            <Thumb platform={row.platform} title={row.title} />
            <span className="t">
              <span className="ttl">
                <strong>{row.title}</strong>
                {row.form && (
                  <span className="ops-form-chip">
                    {formLabel(t, row.form)}
                    {row.formAspect && ` ${row.formAspect}`}
                  </span>
                )}
                {/* 开工入口放在标题列里，不放行尾 —— 行尾位置一动，
                    右侧热度列就跟着每行飘。开工之后台账里已经有形态，
                    再给一个「开工」就是让人对着同一条点两次。 */}
                {row.status === 'idea' && handlers.onStartTopic && (
                  <button
                    type="button"
                    className="ops-row-start"
                    onClick={() => handlers.onStartTopic?.(row.id)}
                  >
                    {t('ops.row.start')}
                  </button>
                )}
              </span>
              <small>
                {/* angle / note 都可能为空。空着时只印平台，不留一个悬空的「·」——
                    模板是 "{{platform}} · {{detail}}"，没有 detail 就拼出「B站 · 」。 */}
                {row.sub
                  ? t('ops.row.platformSub', {
                      platform: platformLabel(t, row.platform),
                      detail: row.sub,
                    })
                  : platformLabel(t, row.platform)}
              </small>
            </span>
            <span className="n">{formatHotness(row.hotness, locale)}</span>
          </RowShell>
        </li>
      ));
    case 'asset':
      return view.pool.map((row) => (
        <li key={row.id}>
          <RowShell onEdit={handlers.onEditAsset ? () => handlers.onEditAsset?.(row.id) : undefined}>
            <Thumb platform={row.platform} title={row.title} />
            <span className="t">
              <strong>{row.title}</strong>
              <small>
                {t('ops.row.platformSub', {
                  platform: platformLabel(t, row.platform),
                  detail: t('ops.row.idle', { days: row.idleDays }),
                })}
              </small>
            </span>
            <span className="n">{t('ops.row.progress', { n: row.progress })}</span>
          </RowShell>
        </li>
      ));
    case 'schedule':
      return view.pool.flatMap((day) =>
        day.assets.length === 0
          ? [
              <li key={day.date} className="empty">
                <div className="ops-list-row">
                  <span className="date">
                    <b>{shortDate(day.date, locale)}</b>
                    <small>{weekdayShort(day.date, locale)}</small>
                  </span>
                  <span className="t">
                    <strong>{t('ops.pool.schedule.gapTitle')}</strong>
                    <small>{t('ops.pool.schedule.gapSub')}</small>
                  </span>
                  <span className="n">{t('ops.pool.schedule.gapBadge')}</span>
                </div>
              </li>,
            ]
          : day.assets.map((entry) => (
              <li key={entry.id}>
                <div className="ops-list-row">
                  <span className="date">
                    <b>{shortDate(day.date, locale)}</b>
                    <small>{weekdayShort(day.date, locale)}</small>
                  </span>
                  <span className="t">
                    <strong>{entry.title}</strong>
                    <small>
                      {t('ops.row.scheduleAt', {
                        time: clockTime(entry.at, locale),
                        platform: platformLabel(t, entry.platform),
                      })}
                    </small>
                  </span>
                  <span className="n">{platformLabel(t, entry.platform)}</span>
                </div>
              </li>
            )),
      );
    case 'review':
      return view.pool.map((row, index) => (
        <li key={row.reviewId}>
          <div className="ops-list-row">
            <span className="rank">{index + 1}</span>
            <Thumb platform={row.platform} title={row.title} />
            <span className="t">
              <strong>{row.title}</strong>
              <small>{reviewSub(row, t, locale)}</small>
              {/* 观众原话：复盘的证据常常就是这一句。有就显示，没有就不占位 ——
                  空行会把整列往下推，读起来像漏了东西。 */}
              {row.commentSample && (
                <span className="ops-quote">
                  <span className="ops-quote-label">{t('ops.row.quote')}</span>
                  <span>「{row.commentSample}」</span>
                </span>
              )}
            </span>
            <span className="n">{formatInteger(row.views, locale)}</span>
          </div>
        </li>
      ));
  }
}

function reviewSub(
  row: OpsReviewRow,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  const parts = [platformLabel(t, row.platform)];
  if (row.completionRate !== null) {
    parts.push(t('ops.row.completion', { rate: Math.round(row.completionRate * 100) }));
  }
  if (row.followers !== 0) {
    parts.push(t('ops.row.followers', { n: formatInteger(row.followers, locale) }));
  }
  return parts.join(' · ');
}
