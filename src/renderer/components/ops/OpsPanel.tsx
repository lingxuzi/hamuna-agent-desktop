import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, ChevronLeft, Pencil, Plus, X } from 'lucide-react';

import {
  getSocialPlatform,
  loginCookieGroup,
  type SocialPlatformId,
} from '../../../shared/socialPlatforms';
import type { OpsAsset, OpsBenchmark, OpsDomainId, OpsReview, OpsTopic } from '../../../shared/ops';
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
import { OpsFinalizeCard } from './OpsFinalizeCard';
import { OpsDirectionCard } from './OpsDirectionCard';
import { DirectionBriefForm } from './DirectionBriefForm';
import { OpsAccountLogin, OpsAccounts } from './OpsAccounts';
import { OpsBenchmarks, BenchmarkForm } from './OpsBenchmarks';
import { OpsClues } from './OpsClues';
import { OpsTerminalCode } from './OpsTerminalCode';
import OpsWizard, { OPS_WIZARD_STEPS, type OpsWizardStep } from './OpsWizard';
import { useOpsState } from './useOpsState';
import { AssetForm, ReviewForm, TopicForm } from './OpsForms';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { useToastOptional } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useCloseLayer } from '@/hooks/useCloseLayer';
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
  wizardStep,
  onWizardStep,
  onWizardDone,
  onWizardDefer,
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
  /** 向导当前步骤。`undefined` = 不在向导模式。 */
  wizardStep?: OpsWizardStep;
  /** 切换向导步骤。传 `undefined` = 退出向导，回到台账。 */
  onWizardStep?: (step: OpsWizardStep | undefined) => void;
  /** 向导走完：父组件记下「这个工作区引导过了」。 */
  onWizardDone?: () => void;
  /**
   * 向导里的「以后再说」：父组件记下标记并关掉面板。
   *
   * 没给这个回调时退回「走完」—— 点下去不能什么也不发生。
   */
  onWizardDefer?: () => void;
}) {
  const { t, i18n } = useTranslation('chat');
  // 展开动效：先挂载再翻 class，否则 transition 不会播（与知识看板同一手法）。
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setUnfolded(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const [domain, setDomain] = useState<OpsDomainId>('topic');
  // 账号与线索不是流水线域，不塞进 `OPS_DOMAIN_IDS`：那是「选题 / 素材 / 排期 /
  // 复盘 / 方向」的流水线，这两样是这台机器在这个工作区上的另两件东西。顶栏
  // 各一个按钮切过去，胶囊行让位给「返回」。
  const [pane, setPane] = useState<'domains' | 'accounts' | 'clues'>('domains');
  /** 正在登录的平台。非空 = 面板让给浏览器。 */
  const [loginPlatform, setLoginPlatform] = useState<SocialPlatformId | null>(null);
  /**
   * 点了「重新登录」但还没确认的平台。确认框开着 = 面板还留在台账里。
   */
  const [reloginTarget, setReloginTarget] = useState<SocialPlatformId | null>(null);
  /**
   * 这一次是「重新登录」：接管时要先清掉这些 cookie 域。
   *
   * 与 `loginPlatform` 分开存，是因为「登录哪个平台」和「这次要不要先退出」
   * 是两件事 —— 第一次登录没有可退出的会话，没什么可清的。
   */
  const [relogin, setRelogin] = useState<{ platform: SocialPlatformId; domains: string[] } | null>(
    null,
  );
  const [form, setForm] = useState<FormRequest | null>(null);
  /** 方向动作一个在飞时冻结全部方向按钮，避免连点写出两个修订。 */
  const [directionBusy, setDirectionBusy] = useState(false);
  const [deleting, setDeleting] = useState<{
    kind: 'topic' | 'asset' | 'clue' | 'benchmark';
    id: string;
    title: string;
  } | null>(null);
  const { state, loading, error, reload } = useOpsState(workspace);
  const toast = useToastOptional();

  /** 向导模式：顶栏换成步骤条，主体交给 OpsWizard。 */
  const inWizard = wizardStep !== undefined && onWizardStep !== undefined;

  /**
   * 顶栏那个「返回」按层退：先退出登录接管回账号清单，再从账号清单回四域台账。
   * 两层共用一个按钮，是因为它们是同一次「往回走」的两步 —— 分成两个按钮会
   * 让用户以为「返回」有两种含义。
   */
  const goBack = useCallback(() => {
    if (loginPlatform) {
      setLoginPlatform(null);
      return;
    }
    setPane('domains');
  }, [loginPlatform]);

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

  /**
   * 点「去登录 / 重新登录」。
   *
   * 台账里没有登录记录 = 第一次登录，没有可退出的会话，直接接管。
   * 有记录 = 有一场会话要退出 → 先把风险说清楚，用户点了才清。
   */
  const startLogin = useCallback(
    (platform: SocialPlatformId) => {
      const account = state.accounts.find((a) => a.platform === platform);
      const loginState = account?.loginState ?? 'unknown';
      if (loginState === 'unknown') {
        setRelogin(null);
        setLoginPlatform(platform);
        return;
      }
      setReloginTarget(platform);
    },
    [state.accounts],
  );

  /** 确认「退出并重新登录」：记住要清哪些域，然后进接管。 */
  const confirmRelogin = useCallback(() => {
    const target = reloginTarget;
    setReloginTarget(null);
    if (!target) return;
    setRelogin({ platform: target, domains: loginCookieGroup(getSocialPlatform(target)).domains });
    setLoginPlatform(target);
  }, [reloginTarget]);

  /**
   * cookie 清完了：台账改成「已失效」。
   *
   * 受牵连的兄弟平台一起改 —— 它们的会话是同一条 cookie，清掉就是真掉线了。
   * 台账还写着「已登录」而发布时撞登录墙，比多登一次号糟得多。
   */
  const onReloginCleared = useCallback(async () => {
    if (!relogin) return;
    const platform = getSocialPlatform(relogin.platform);
    const siblings = loginCookieGroup(platform).siblings;
    const now = new Date().toISOString();
    try {
      for (const id of [platform.id, ...siblings]) {
        // 兄弟平台里只有「本来记着已登录」的那些要改：没记录过的平台本来
        // 就是未登录，凭空给它记一条「已失效」是造了个没发生过的状态。
        const account = state.accounts.find((a) => a.platform === id);
        if (id !== platform.id && account?.loginState !== 'success') continue;
        await opsUpsert(workspace, {
          kind: 'account',
          platform: id,
          loginState: 'expired',
          lastCheckedAt: now,
        });
      }
    } catch (err) {
      // 台账写失败不牵连已经完成的退出：cookie 真的没了，账本没跟上而已。
      fail(err);
    }
  }, [relogin, state.accounts, workspace, fail]);

  /** 确认框里那段风险说明。 */
  const reloginMessage = useMemo(() => {
    if (!reloginTarget) return '';
    const platform = platformLabel(t, reloginTarget);
    const siblings = loginCookieGroup(getSocialPlatform(reloginTarget)).siblings;
    if (siblings.length === 0) {
      return t('ops.account.reloginRisk', { platform });
    }
    const others = new Intl.ListFormat(i18n.language, {
      style: 'short',
      type: 'conjunction',
    }).format(siblings.map((id) => platformLabel(t, id)));
    return t('ops.account.reloginRiskShared', { platform, others });
  }, [reloginTarget, t, i18n.language]);

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
    async (row: OpsDirectionRow) => {
      setDirectionBusy(true);
      try {
        // 先在台账里记下「派过工」，再把活派出去。
        //
        // 顺序反过来就留下一个说不清的状态：Agent 已经在整了，台账却没记下派过
        // 那一行只能显示「等 Agent」——可派工那一刻到底有没有发生，没人知道。
        // 记下它，这一行才能说清「现在等谁」。
        await opsUpsert(workspace, {
          kind: 'direction',
          platform: row.platform,
          dispatch: true,
        });
      } catch (err) {
        // 没记上派工就不派活：台账与实际脱节比晚一步更糟。
        fail(err);
        return;
      } finally {
        setDirectionBusy(false);
      }
      onSendToAgent(
        t('ops.direction.askAgent', {
          platform: t(`settings:accounts.platform.${row.platform}`),
          platformId: row.platform,
          brief: row.brief.trim(),
        }),
      );
    },
    [fail, onSendToAgent, t, workspace],
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
    <div
      className={`ops ops-pop ${unfolded ? 'ops-pop-open' : ''} ${
        loginPlatform ? 'ops-takeover-mode' : ''
      }`}
    >
      <header className="ops-top">
        {inWizard ? (
          loginPlatform ? (
            // 接管中：面板整个让给浏览器，只留一个「返回」出口。
            <button type="button" className="ops-ghost" onClick={goBack}>
              <ChevronLeft size={14} aria-hidden="true" />
              {t('ops.account.back')}
            </button>
          ) : (
            <div className="ops-steps" role="tablist" aria-label={t('ops.wizard.title')}>
              {OPS_WIZARD_STEPS.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={wizardStep === id}
                  onClick={() => onWizardStep?.(id)}
                >
                  <span className="n" aria-hidden="true">
                    {i + 1}
                  </span>
                  {t(`ops.wizard.step.${id}`)}
                </button>
              ))}
            </div>
          )
        ) : pane === 'domains' ? (
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
        ) : (
          <button type="button" className="ops-ghost" onClick={goBack}>
            <ChevronLeft size={14} aria-hidden="true" />
            {pane === 'accounts' ? t('ops.account.back') : t('ops.clue.back')}
          </button>
        )}
        <span className="ops-sp" />
        {inWizard ? (
          <button type="button" className="ops-ghost" onClick={() => onWizardStep?.(undefined)}>
            {t('ops.wizard.exit')}
          </button>
        ) : (
          pane === 'domains' && (
            <>
              <button type="button" className="ops-ghost" onClick={() => setPane('clues')}>
                {t('ops.clue.open')}
              </button>
              <button type="button" className="ops-ghost" onClick={() => setPane('accounts')}>
                {t('ops.account.open')}
              </button>
              <button
                type="button"
                className="ops-ghost"
                onClick={() => onWizardStep?.(OPS_WIZARD_STEPS[0])}
              >
                {t('ops.wizard.open')}
              </button>
            </>
          )
        )}
        <OpsTerminalCode />
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

      {loginPlatform ? (
        <OpsAccountLogin
          workspace={workspace}
          platform={getSocialPlatform(loginPlatform)}
          reloginDomains={relogin?.platform === loginPlatform ? relogin.domains : undefined}
          onReloginCleared={onReloginCleared}
          onClose={() => setLoginPlatform(null)}
        />
      ) : loading ? (
        <p className="ops-status">{t('ops.status.loading')}</p>
      ) : error ? (
        <div className="ops-status">
          <span>{t('ops.status.error', { reason: error })}</span>
          <button type="button" className="ops-ghost" onClick={reload}>
            {t('ops.status.retry')}
          </button>
        </div>
      ) : inWizard && wizardStep && onWizardStep ? (
        <div className="ops-body" data-ops-pane="wizard">
          <div className="ops-main">
            <OpsWizard
              workspace={workspace}
              state={state}
              step={wizardStep}
              onStep={onWizardStep}
              onLogin={startLogin}
              // 向导的交接走**同一条**普通交接：面板先关，Agent 的提问卡才看得见。
              // 面板浮在对话区上方，留着它 = 提问卡被盖住，人答不了 —— 那正是
              // 派工之后唯一要做的事。
              onSendToAgent={onSendToAgent}
              onDone={() => onWizardDone?.()}
              onDefer={() => (onWizardDefer ? onWizardDefer() : onWizardDone?.())}
            />
          </div>
        </div>
      ) : pane === 'accounts' ? (
        <div className="ops-body" data-ops-pane="accounts">
          <div className="ops-main">
            <OpsAccounts
              workspace={workspace}
              accounts={state.accounts}
              onLogin={startLogin}
            />
          </div>
        </div>
      ) : pane === 'clues' ? (
        <div className="ops-body" data-ops-pane="clues">
          <div className="ops-main">
            <OpsClues
              workspace={workspace}
              clues={state.clues}
              assets={state.assets}
              onDelete={(clue) =>
                setDeleting({
                  kind: 'clue',
                  id: clue.id,
                  title: clue.content.trim() || t('ops.clue.noContent'),
                })
              }
            />
          </div>
        </div>
      ) : (
        <div className="ops-body" data-ops-pane="domains" data-ops-domain={domain}>
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
            <div className="ops-grid">
              {view.domain === 'review' && <OpsChartCard view={view} />}
              {view.domain === 'direction' ? (
                <OpsDirectionCard
                  view={view}
                  busy={directionBusy || form !== null || deleting !== null}
                  onWriteBrief={(platform) => {
                    const row = view.pool.find((r) => r.platform === platform);
                    setForm({ kind: 'direction:brief', platform, brief: row?.brief ?? '' });
                  }}
                  onAskAgent={(row) => void askAgentAboutDirection(row)}
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
              {/* 方向域不用分布条：一个平台一条方向，「每平台几条已生效」永远是
                  0 或 1。换成按平台的定稿状态（走到哪一步 / 卡在谁那儿）。 */}
              {view.domain !== 'direction' && <OpsDistCard view={view} />}
              {view.domain === 'direction' && <OpsFinalizeCard view={view} />}
              {/* 对标账号收在右栏：方向卡通栏时右栏正好是对标，两边像不像一眼看到。
                  平台还没立方向时也能先加。 */}
              {view.domain === 'direction' && (
                <OpsBenchmarks
                  benchmarks={state.benchmarks}
                  onAdd={() => setForm({ kind: 'benchmark:new' })}
                  onEdit={(benchmark: OpsBenchmark) =>
                    setForm({ kind: 'benchmark:edit', benchmark })
                  }
                  onDelete={(benchmark: OpsBenchmark) =>
                    setDeleting({
                      kind: 'benchmark',
                      id: benchmark.id,
                      title: benchmark.name.trim() || benchmark.profileUrl,
                    })
                  }
                />
              )}
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

      {reloginTarget && (
        <ConfirmDialog
          title={t('ops.account.reloginTitle', { platform: platformLabel(t, reloginTarget) })}
          message={reloginMessage}
          confirmText={t('ops.account.reloginConfirm')}
          cancelText={t('ops.form.cancel')}
          confirmVariant="danger"
          onConfirm={confirmRelogin}
          onCancel={() => setReloginTarget(null)}
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
  | { kind: 'benchmark:new' }
  | { kind: 'benchmark:edit'; benchmark: OpsBenchmark }
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
    case 'benchmark:new':
    case 'benchmark:edit':
      return (
        <BenchmarkForm
          workspace={workspace}
          initial={request.kind === 'benchmark:edit' ? request.benchmark : undefined}
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
              <div className="ops-tip-head">
                {/* 证据性质：这条结论凭什么这么说。强度（confidence）在数字上，
                    种类得看得见——「核实过的 0.5」和「推出来的 0.9」不是一回事。 */}
                <span className="ops-basis" data-basis={rule.basis}>
                  <i aria-hidden="true" />
                  {t(`ops.basis.${rule.basis}`)}
                </span>
                <strong>{rule.name}</strong>
              </div>
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
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const nameRef = useRef<HTMLDivElement>(null);

  // 「展开全文」只在真的被截断时才出现 —— 没得展开还摆个按钮，就是个坏掉的
  // 功能。判定靠实测（scrollHeight > clientHeight），不靠字数猜：卡片宽度
  // 会变（面板拉宽、窄栏摊平），同一段文字在不同宽度下截断与否不一样。
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [parts.name, expanded]);

  // Cmd+W 收起展开的全文。没展开时返回 false —— 这一层不吃掉关闭键，
  // 面板该关还得关。
  useCloseLayer(() => {
    if (!expanded) return false;
    setExpanded(false);
    return true;
  }, 300);

  return (
    <section className="ops-next">
      <span className="top">
        <span>{parts.top}</span>
        <span>
          <span className="pulse" /> <span>{parts.when}</span>
        </span>
      </span>
      <div className="big">{parts.big}</div>
      <div className={`name ${expanded ? 'open' : ''}`} ref={nameRef}>
        {parts.name}
      </div>
      {overflowing && (
        <button type="button" className="ops-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('ops.dark.collapse') : t('ops.dark.expand')}
        </button>
      )}
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
