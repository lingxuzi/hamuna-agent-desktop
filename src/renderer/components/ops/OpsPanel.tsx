import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, X } from 'lucide-react';

import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import type { OpsAsset, OpsDomainId, OpsReview, OpsTopic } from '../../../shared/ops';
import { OPS_DOMAIN_IDS } from '../../../shared/ops';
import {
  deriveOpsView,
  type OpsAssetView,
  type OpsDarkCard as OpsDarkCardData,
  type OpsDirectionRow,
  type OpsDirectionView,
  type OpsReviewView,
  type OpsScheduleView,
  type OpsTopicView,
  type OpsView,
} from '../../../shared/ops-derive';
import {
  clockTime,
  formatCompact,
  formatInteger,
  formatTick,
  platformLabel,
  shortDate,
} from './opsFormat';
import OpsHero from './OpsHero';
import { OpsDistCard, OpsPoolCard } from './OpsCards';
import { OpsDirectionCard } from './OpsDirectionCard';
import { DirectionBriefForm } from './DirectionBriefForm';
import { useOpsState } from './useOpsState';
import { AssetForm, ReviewForm, TopicForm } from './OpsForms';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { useToastOptional } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import './ops.css';

/**
 * 运营视图：选题 / 素材 / 排期 / 复盘 四域台账。
 *
 * 写入（Phase 6）：增删改走 `cmd_ops_upsert` / `cmd_ops_delete` 补丁语义。
 * **没有乐观更新** —— 写成功后 Rust emit `ops:changed`，面板经 useOpsState
 * 重读权威快照；写者本地再养一份 state 就是两套真相。
 *
 * 四域共用一副外壳：顶栏胶囊切域 / Hero 结论句 + 指标带 + 动作 / 卡片网格 /
 * 右栏深墨主角卡。差别只在内容与口径，口径全部来自 `shared/ops-derive.ts`，
 * 这里不做计算。
 */
export default function OpsPanel({
  workspace,
  onClose,
  onSendToAgent,
}: {
  workspace: string;
  onClose: () => void;
  /**
   * 把一条普通用户消息送进本 Tab 的会话。
   *
   * 方向域需要它：结构化方向是 Agent 的活，面板只负责把「这句话 + 纪律」
   * 交给它。**不在这里拼 CLI 命令** —— 拼了就是把 skill 的步骤复制进组件，
   * 那边改一步这里就错一步。
   */
  onSendToAgent: (text: string) => void;
}) {
  const { t } = useTranslation('chat');
  // 展开动效：先挂载再翻 class，否则 transition 不会播（与知识看板同一手法）。
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setUnfolded(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const [domain, setDomain] = useState<OpsDomainId>('topic');
  const [form, setForm] = useState<FormRequest | null>(null);
  /** 方向动作一个在飞时冻结全部方向按钮，避免连点写出两个修订。 */
  const [directionBusy, setDirectionBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: 'topic' | 'asset'; id: string; title: string } | null>(null);
  const { state, loading, error, reload } = useOpsState(workspace);
  const toast = useToastOptional();

  const notify = useCallback(
    (message: string) => {
      toast?.success(message);
    },
    [toast],
  );

  const fail = useCallback(
    (err: unknown) => {
      toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
    },
    [toast, t],
  );

  // `now` 只在数据或域变化时重算：每次 render 都 new Date() 会让派生结果不稳，
  // 且 useMemo 依赖里塞 Date 等于每帧失效。
  const view = useMemo(() => deriveOpsView(state, domain, new Date()), [state, domain]);

  /** 建议卡「写进规则」：proposed → active，原地完成，不弹窗。 */
  const activateRule = useCallback(
    async (ruleId: string) => {
      try {
        await opsUpsert(workspace, { kind: 'rule', id: ruleId, status: 'active' });
        notify(t('ops.toast.ruleActivated'));
      } catch (err) {
        fail(err);
      }
    },
    [workspace, notify, fail, t],
  );

  /**
   * 把一行方向交给 Agent。
   *
   * 消息里放的是**人的原话 + 要 Agent 做什么**，不放字段清单：结构化口径在
   * `ops-direction` skill 里，那边改口径这里不用跟着改。平台 id 必须带上 ——
   * 会话里可能有多个账号，Agent 从对话里推不出用户在说哪一个。
   */
  const askAgentAboutDirection = useCallback(
    (row: OpsDirectionRow) => {
      onSendToAgent(
        t('ops.direction.askAgent', {
          platform: t(`settings:accounts.platform.${row.platform}`),
          platformId: row.platform,
          brief: row.brief.trim(),
        }),
      );
    },
    [onSendToAgent, t],
  );

  /** 采纳 / 驳回修订。两种都是 store 侧一个动作键，不再发字段值。 */
  const resolveProposal = useCallback(
    async (row: OpsDirectionRow, action: 'accept' | 'reject') => {
      setDirectionBusy(true);
      try {
        await opsUpsert(workspace, {
          kind: 'direction',
          platform: row.platform,
          [action === 'accept' ? 'acceptProposal' : 'rejectProposal']: true,
        });
        notify(
          action === 'accept'
            ? t('ops.toast.proposalAccepted')
            : t('ops.toast.proposalRejected'),
        );
      } catch (err) {
        fail(err);
      } finally {
        setDirectionBusy(false);
      }
    },
    [workspace, notify, fail, t],
  );

  return (
    <div className={`ops ops-pop ${unfolded ? 'ops-pop-open' : ''}`}>
      <header className="ops-top">
        <div className="ops-pills" role="tablist" aria-label={t('ops.title')}>
          {OPS_DOMAIN_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={domain === id}
              onClick={() => setDomain(id)}
            >
              {t(`ops.domain.${id}`)}
            </button>
          ))}
        </div>
        <span className="ops-sp" />
        <button
          type="button"
          className="ops-ghost"
          onClick={onClose}
          aria-label={t('ops.close')}
          title={t('ops.close')}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      {loading ? (
        <p className="ops-status">{t('ops.status.loading')}</p>
      ) : error ? (
        <div className="ops-status">
          <span>{t('ops.status.error', { reason: error })}</span>
          <button type="button" className="ops-ghost" onClick={reload}>
            {t('ops.status.retry')}
          </button>
        </div>
      ) : (
        <div className="ops-body">
          <div className="ops-main">
            <OpsHero
              lead={<Lead view={view} />}
              metrics={view.metrics}
              actions={
                <HeroActions
                  domain={domain}
                  busy={form !== null || deleting !== null}
                  onNewTopic={() => setForm({ kind: 'topic:new' })}
                  onNewAsset={() => setForm({ kind: 'asset:new' })}
                  onNewReview={() => setForm({ kind: 'review:new' })}
                />
              }
            />
            <div className={`ops-grid ${view.domain === 'review' ? '' : 'ops-grid-2'}`}>
              {view.domain === 'review' && <OpsChartCard view={view} />}
              {view.domain === 'direction' ? (
                <OpsDirectionCard
                  view={view}
                  busy={directionBusy || form !== null || deleting !== null}
                  onWriteBrief={(platform) => {
                    const row = view.pool.find((r) => r.platform === platform);
                    setForm({ kind: 'direction:brief', platform, brief: row?.brief ?? '' });
                  }}
                  onAskAgent={askAgentAboutDirection}
                  onAcceptProposal={(row) => void resolveProposal(row, 'accept')}
                  onRejectProposal={(row) => void resolveProposal(row, 'reject')}
                />
              ) : (
                <OpsPoolCard
                  view={view}
                  onEditTopic={(topicId) => {
                    const topic = state.topics.find((tp) => tp.id === topicId);
                    if (topic) setForm({ kind: 'topic:edit', topic });
                  }}
                  onEditAsset={(assetId) => {
                    const asset = state.assets.find((a) => a.id === assetId);
                    if (asset) setForm({ kind: 'asset:edit', asset });
                  }}
                />
              )}
              <OpsDistCard view={view} />
              {view.domain === 'review' && <OpsAdviceCard view={view} onActivate={activateRule} />}
            </div>
          </div>
          <aside className="ops-rail">
            <DarkCard dark={view.dark} />
            <NotesCard domain={view.domain} />
          </aside>
        </div>
      )}

      {form && (
        <FormHost
          workspace={workspace}
          request={form}
          state={state}
          onClose={() => setForm(null)}
          onDone={(message) => {
            setForm(null);
            notify(message);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('ops.delete.title')}
          message={t('ops.delete.message', { name: deleting.title })}
          confirmText={t('ops.delete.confirm')}
          cancelText={t('ops.form.cancel')}
          confirmVariant="danger"
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void (async () => {
              try {
                const { opsDelete } = await import('./opsWrite');
                await opsDelete(workspace, target.kind, target.id);
                notify(t('ops.toast.deleted'));
              } catch (err) {
                fail(err);
              }
            })();
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/* ── 表单调度：一个 state 槽位挂三域对话框 ─────────── */

type FormRequest =
  | { kind: 'topic:new' }
  | { kind: 'topic:edit'; topic: OpsTopic }
  | { kind: 'asset:new' }
  | { kind: 'asset:edit'; asset: OpsAsset }
  | { kind: 'review:new' }
  | { kind: 'review:edit'; review: OpsReview }
  | { kind: 'direction:brief'; platform: SocialPlatformId; brief: string };

function FormHost({
  workspace,
  request,
  state,
  onClose,
  onDone,
}: {
  workspace: string;
  request: FormRequest;
  state: ReturnType<typeof useOpsState>['state'];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  switch (request.kind) {
    case 'topic:new':
    case 'topic:edit':
      return (
        <TopicForm
          workspace={workspace}
          initial={request.kind === 'topic:edit' ? request.topic : undefined}
          onClose={onClose}
          onDone={onDone}
        />
      );
    case 'asset:new':
    case 'asset:edit':
      return (
        <AssetForm
          workspace={workspace}
          initial={request.kind === 'asset:edit' ? request.asset : undefined}
          topics={state.topics.filter((tp) => tp.status !== 'dropped')}
          onClose={onClose}
          onDone={onDone}
        />
      );
    case 'review:new':
    case 'review:edit':
      return (
        <ReviewForm
          workspace={workspace}
          initial={request.kind === 'review:edit' ? request.review : undefined}
          assets={state.assets}
          onClose={onClose}
          onDone={onDone}
        />
      );
    case 'direction:brief':
      return (
        <DirectionBriefForm
          workspace={workspace}
          platform={request.platform}
          brief={request.brief}
          // 已经有这条记录了：改平台等于换一条记录，所以锁住。
          platformLocked={state.directions.some((d) => d.platform === request.platform)}
          onClose={onClose}
          onDone={onDone}
        />
      );
  }
}

/* ── Hero 动作：按域给「这域此刻最该做的三件事」 ──────────────── */

interface HeroActionsProps {
  domain: OpsDomainId;
  /** 任一对话框 / 确认框开着时冻结 Hero 按钮，避免叠出两个编辑态。 */
  busy: boolean;
  onNewTopic: () => void;
  onNewAsset: () => void;
  onNewReview: () => void;
}

/** 只画**真能落盘**的动作：新建走表单对话框，写进台账。
 *
 * 拉热点 / 导入对标 / 同步日历是 Phase 8（采集段）的活，这一步不画——画了
 * 没有处理函数，等于给一个点了没反应的按钮（Phase 5 的老教训）。排期域同理
 * 不放 Hero 按钮：排期在素材行的铅笔入口与素材表单里完成。
 */
function HeroActions({ domain, busy, onNewTopic, onNewAsset, onNewReview }: HeroActionsProps) {
  const { t } = useTranslation('chat');
  // 方向域的「新动作」就在每一行上（写方向 / 交给 Agent），Hero 再放一个
  // 重复入口只会让人以为它和行上的按钮不同。等方向为空时需要引导看空态文案。
  if (domain === 'direction') return null;
  if (domain === 'topic') {
    return (
      <button type="button" className="ops-act solid" disabled={busy} onClick={onNewTopic}>
        <Plus aria-hidden="true" />
        {t('ops.act.newTopic')}
      </button>
    );
  }
  if (domain === 'asset') {
    return (
      <button type="button" className="ops-act solid" disabled={busy} onClick={onNewAsset}>
        <Plus aria-hidden="true" />
        {t('ops.act.newAsset')}
      </button>
    );
  }
  if (domain === 'schedule') {
    return null;
  }
  return (
    <button type="button" className="ops-act solid" disabled={busy} onClick={onNewReview}>
      <Pencil aria-hidden="true" />
      {t('ops.act.manualEntry')}
    </button>
  );
}

/* ── Hero 结论句：四域句式不同，逐域写死，不套模板 ─────────────── */

function Lead({ view }: { view: OpsView }) {
  switch (view.domain) {
    case 'direction':
      return <DirectionLead view={view} />;
    case 'topic':
      return <TopicLead view={view} />;
    case 'asset':
      return <AssetLead view={view} />;
    case 'schedule':
      return <ScheduleLead view={view} />;
    case 'review':
      return <ReviewLead view={view} />;
  }
}

function DirectionLead({ view }: { view: OpsDirectionView }) {
  const { t } = useTranslation('chat');
  const focus = view.pool.find((row) => row.id === view.lead.focusId) ?? view.pool[0];
  if (!focus) return <>{t('ops.lead.directionEmpty')}</>;
  const name = focus.positioning || focus.brief || t('ops.direction.noBrief');
  return (
    <Trans
      i18nKey="ops.lead.direction"
      ns="chat"
      components={LEAD_COMPONENTS}
      values={{ active: view.lead.active, pending: view.lead.pending, name }}
    />
  );
}

/** 数字走衬线大字、产品名整体不断行——两处 `<Trans>` 共用的组件表。 */
const LEAD_COMPONENTS = {
  b: <b />,
  num: <span className="ops-num" />,
  who: <b className="ops-who" />,
};

function TopicLead({ view }: { view: OpsTopicView }) {
  const { t } = useTranslation('chat');
  const focus = view.pool.find((row) => row.id === view.lead.focusId);
  if (!focus) return <>{t('ops.lead.topicEmpty')}</>;
  return (
    <Trans
      i18nKey="ops.lead.topic"
      ns="chat"
      components={LEAD_COMPONENTS}
      values={{ pending: view.lead.pending, hot: view.lead.fromHotspot, name: focus.title }}
    />
  );
}

function AssetLead({ view }: { view: OpsAssetView }) {
  const { t } = useTranslation('chat');
  const blocked = view.pool.find((row) => row.id === view.lead.blockedId);
  if (!blocked) return <>{t('ops.lead.assetEmpty')}</>;
  return (
    <Trans
      i18nKey="ops.lead.asset"
      ns="chat"
      components={LEAD_COMPONENTS}
      values={{ producing: view.lead.producing, due: view.lead.dueToday, name: blocked.title }}
    />
  );
}

function ScheduleLead({ view }: { view: OpsScheduleView }) {
  const { t } = useTranslation('chat');
  const next = view.pool.flatMap((day) => day.assets).find((a) => a.id === view.lead.nextId);
  if (!next) return <>{t('ops.lead.scheduleEmpty')}</>;
  return (
    <Trans
      i18nKey="ops.lead.schedule"
      ns="chat"
      components={LEAD_COMPONENTS}
      values={{ week: view.lead.thisWeek, empty: view.lead.emptyDays, name: next.title }}
    />
  );
}

function ReviewLead({ view }: { view: OpsReviewView }) {
  const { t, i18n } = useTranslation('chat');
  const best = view.pool.find((row) => row.assetId === view.lead.bestId);
  if (!best) return <>{t('ops.lead.reviewEmpty')}</>;
  return (
    <Trans
      i18nKey="ops.lead.review"
      ns="chat"
      components={LEAD_COMPONENTS}
      values={{
        count: view.lead.published,
        views: formatCompact(view.lead.totalViews, i18n.language),
        name: best.title,
      }}
    />
  );
}

/* ── 趋势图（仅复盘域） ───────────────────────────────────────── */

const CHART_W = 640;
const CHART_TOP = 12;
const CHART_BOTTOM = 154;

function OpsChartCard({ view }: { view: OpsReviewView }) {
  const { t, i18n } = useTranslation('chat');
  const series = view.series;
  // series 恒有 15 个点（没数据的那天补 0），所以"有没有数据"要看总和而不是长度。
  const hasData = series.some((p) => p.views > 0);
  const max = Math.max(...series.map((p) => p.views), 1);
  const lastIndex = Math.max(series.length - 1, 1);

  const xOf = (i: number) => (i / lastIndex) * CHART_W;
  const yOf = (v: number) => CHART_BOTTOM - (v / max) * (CHART_BOTTOM - CHART_TOP);

  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i)} ${yOf(p.views)}`).join(' ');
  const area = `${line} L${CHART_W} ${CHART_BOTTOM} L0 ${CHART_BOTTOM} Z`;

  let peakIndex = 0;
  for (let i = 1; i < series.length; i += 1) {
    if (series[i].views > series[peakIndex].views) peakIndex = i;
  }
  const peak = series[peakIndex];
  const peakLabel = formatCompact(peak.views, i18n.language);

  // 横轴取 5 个等距刻度：15 天全标会挤成一团。
  const ticks = [0, 3, 7, 11, lastIndex].filter(
    (i, at, arr) => i < series.length && arr.indexOf(i) === at,
  );

  return (
    <section className="ops-card ops-c-chart">
      <div className="ops-card-head">
        <h2>{t('ops.chart.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.chart.meta')}</span>
      </div>
      <div className="ops-plot">
        {hasData ? (
          <>
            <div className="ops-yaxis" aria-hidden="true">
              {[max, max / 2, 0].map((v) => (
                <span key={v}>{formatTick(v, i18n.language)}</span>
              ))}
            </div>
            <div className="ops-chart-wrap">
              <svg
                className="ops-chart"
                viewBox={`0 0 ${CHART_W} 168`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t('ops.chart.aria', { peak: peakLabel })}
              >
                <line className="axis" x1="0" y1={CHART_TOP} x2={CHART_W} y2={CHART_TOP} />
                <line className="axis" x1="0" y1={(CHART_TOP + CHART_BOTTOM) / 2} x2={CHART_W} y2={(CHART_TOP + CHART_BOTTOM) / 2} />
                <line className="axis" x1="0" y1={CHART_BOTTOM} x2={CHART_W} y2={CHART_BOTTOM} />
                <path className="area" d={area} />
                <path className="line" d={line} />
              </svg>
              {/* 峰值点用 HTML 画：SVG 被横向拉伸，圆点会被拉成椭圆。 */}
              <span
                className="ops-peak"
                aria-hidden="true"
                style={{ left: `${(xOf(peakIndex) / CHART_W) * 100}%`, top: `${yOf(peak.views)}px` }}
              />
              <span
                className="ops-peak-tag"
                style={{ left: `${(xOf(peakIndex) / CHART_W) * 100}%`, top: `${yOf(peak.views)}px` }}
              >
                {t('ops.chart.peak', { value: peakLabel })}
              </span>
            </div>
          </>
        ) : (
          // 空账本画一条贴着零轴的直线 + 两个「1」刻度，比不出图的空态更糟。
          <p className="ops-empty">{t('ops.chart.empty')}</p>
        )}
      </div>
      <div className="ops-xaxis">
        {ticks.map((i) => (
          <span key={series[i].date}>{shortDate(series[i].date, i18n.language)}</span>
        ))}
      </div>
    </section>
  );
}

/* ── 建议卡（仅复盘域） ───────────────────────────────────────── */

function OpsAdviceCard({ view, onActivate }: { view: OpsReviewView; onActivate: (ruleId: string) => void }) {
  const { t } = useTranslation('chat');
  return (
    <section className="ops-card ops-c-adv">
      <div className="ops-card-head">
        <h2>{t('ops.advice.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.advice.meta')}</span>
      </div>
      {view.advice.length === 0 ? (
        <p className="ops-empty">{t('ops.advice.empty')}</p>
      ) : (
        <div className="ops-advice">
          {view.advice.map((rule) => (
            <div className="ops-tip" key={rule.id}>
              <strong>{rule.name}</strong>
              <p>{rule.rule}</p>
              {rule.evidenceBars && rule.evidenceBars.length > 0 && (
                <ul className="ops-bars mini">
                  {rule.evidenceBars.map((bar) => (
                    <li key={bar.name}>
                      <span className="name">{bar.name}</span>
                      <span className="val">{bar.val}</span>
                      <span className="track">
                        <i className={bar.mut ? 'mut' : undefined} style={{ width: `${bar.pct}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {/* proposed 才有「写进规则」：已生效的规则再点一次是空操作。 */}
              {rule.status === 'proposed' && (
                <button type="button" className="act" onClick={() => onActivate(rule.id)}>
                  <Check aria-hidden="true" />
                  {t('ops.advice.activate')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── 右栏：深墨主角卡 + 该域要点 ─────────────────────────────── */

interface DarkParts {
  top: string;
  when: string;
  big: string;
  name: string;
  foot: string;
}

function DarkCard({ dark }: { dark: OpsDarkCardData }) {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.language;
  const parts = darkParts(dark, t, locale);

  return (
    <section className="ops-next">
      <span className="top">
        <span>{parts.top}</span>
        <span>
          <span className="pulse" /> <span>{parts.when}</span>
        </span>
      </span>
      <div className="big">{parts.big}</div>
      <div className="name">{parts.name}</div>
      {parts.foot && <div className="foot">{parts.foot}</div>}
    </section>
  );
}

function darkParts(
  dark: OpsDarkCardData,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): DarkParts {
  const empty: DarkParts = {
    top: t(`ops.dark.${dark.kind}.top`),
    when: t('ops.dark.emptyWhen'),
    big: '—',
    name: t('ops.dark.emptyName'),
    foot: '',
  };

  switch (dark.kind) {
    case 'direction': {
      if (!dark.title) return empty;
      return {
        top: t('ops.dark.direction.top'),
        when:
          dark.proposedAt !== null
            ? t('ops.dark.direction.pending')
            : dark.idleDays === null
              ? t('ops.dark.emptyWhen')
              : t('ops.dark.idleDays', { days: dark.idleDays }),
        // 方向域没有数字指标，「大数」位置放平台名——它是这张卡的身份。
        big: dark.platform ? platformLabel(t, dark.platform) : '—',
        name: dark.title,
        foot: dark.proposedAt !== null ? t('ops.dark.direction.footPending') : '',
      };
    }
    case 'topic': {
      if (!dark.title) return empty;
      return {
        top: t('ops.dark.topic.top'),
        when:
          dark.idleDays === null
            ? t('ops.dark.emptyWhen')
            : t('ops.dark.idleDays', { days: dark.idleDays }),
        big: dark.hotness === null ? '—' : formatCompact(dark.hotness, locale),
        name: dark.title,
        foot: [platformLabel(t, dark.platform), dark.source && t(`ops.dist.topicSource.${dark.source}`)]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'asset': {
      if (!dark.title) return empty;
      return {
        top: t('ops.dark.asset.top'),
        when:
          dark.idleDays === null
            ? t('ops.dark.emptyWhen')
            : t('ops.dark.idleDays', { days: dark.idleDays }),
        big: dark.progress === null ? '—' : `${dark.progress}%`,
        name: dark.title,
        foot: platformLabel(t, dark.platform),
      };
    }
    case 'schedule': {
      if (!dark.title || !dark.at) return empty;
      return {
        top: t('ops.dark.schedule.top'),
        when: clockTime(dark.at, locale),
        big: shortDate(dark.at, locale),
        name: dark.title,
        foot: platformLabel(t, dark.platform),
      };
    }
    case 'review': {
      if (!dark.title) return empty;
      return {
        top: t('ops.dark.review.top'),
        when: t('ops.dark.review.when'),
        big: dark.gap === null ? '—' : `+${formatInteger(dark.gap, locale)}`,
        name:
          dark.leadPct === null
            ? t('ops.dark.review.namePlain')
            : t('ops.dark.review.name', { pct: dark.leadPct }),
        foot: [
          dark.title,
          dark.topViews === null ? null : formatInteger(dark.topViews, locale),
          platformLabel(t, dark.platform),
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
  }
}

const NOTES_COUNT = 4;

function NotesCard({ domain }: { domain: OpsDomainId }) {
  const { t } = useTranslation('chat');
  return (
    <section className="ops-card ops-c-note">
      <div className="ops-card-head">
        <h2>{t('ops.notes.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.notes.meta', { n: NOTES_COUNT })}</span>
      </div>
      <ul className="ops-notes">
        {Array.from({ length: NOTES_COUNT }, (_, i) => (
          <li key={i}>
            <span className="dot" aria-hidden="true" />
            <span>{t(`ops.notes.${domain}.${i + 1}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
