import { useTranslation } from 'react-i18next';

import type {
  OpsAssetView,
  OpsDistBar,
  OpsReviewRow,
  OpsReviewView,
  OpsScheduleView,
  OpsTopicView,
} from '../../../shared/ops-derive';
import {
  clockTime,
  formatCompact,
  formatHotness,
  formatInteger,
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
  return (
    <OpsCard
      title={t(`ops.dist.${view.domain}.title`)}
      meta={t(`ops.dist.${view.domain}.meta`)}
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
    <span className="thumb" data-platform={platform ?? undefined} aria-hidden="true">
      {initial}
    </span>
  );
}

export function OpsPoolCard({
  view,
  className,
}: {
  view: OpsTopicView | OpsAssetView | OpsScheduleView | OpsReviewView;
  className?: string;
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
          <ol className="ops-list">{renderRows(view, t, i18n.language)}</ol>
        </>
      )}
    </OpsCard>
  );
}

function renderRows(
  view: OpsTopicView | OpsAssetView | OpsScheduleView | OpsReviewView,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): React.ReactNode[] {
  switch (view.domain) {
    case 'topic':
      return view.pool.map((row) => (
        <li key={row.id}>
          <div className="ops-list-row">
            <Thumb platform={row.platform} title={row.title} />
            <span className="t">
              <strong>{row.title}</strong>
              <small>
                {t('ops.row.platformSub', {
                  platform: platformLabel(t, row.platform),
                  detail: row.sub,
                })}
              </small>
            </span>
            <span className="n">{formatHotness(row.hotness, locale)}</span>
          </div>
        </li>
      ));
    case 'asset':
      return view.pool.map((row) => (
        <li key={row.id}>
          <div className="ops-list-row">
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
          </div>
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
