// 冷启动向导：运营台的一个模式，取代 `/BOOTSTRAP`。
//
// **为什么是运营台的一个模式，不是另一块 UI**：登录要接管原生浏览器，物料要
// 写工作区，方向 / 对标 / 选题要写台账 —— 这三样东西的落点运营台全都有。
// 再造一块壳，等于把「浏览器接管」「台账写入」「工作区文件 IO」各做第二遍。
//
// **六步的分工**：① 登录 ② 方向原话 ③ 物料 ④ 账号画像 ⑤ 对标 ⑥ 第一轮选题。
// 人只做「只有人能做」的部分（登录、说原话、给物料、填画像），候选和选题是
// Agent 读公开页 / 搜热点得出的，GUI 在这里只是决策界面。
//
// **向导模式下交给 Agent 的活不关面板**：⑤⑥ 的产出是台账里长出来的列表，
// 关了面板人就得自己记走到第几步、再从哪儿点回来。面板开着，`ops:changed`
// 一到，列表自己就长出来。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import type { OpsBenchmark, OpsState, OpsTopic } from '../../../shared/ops';
import { localDate } from '../../../shared/logTime';
import { useWorkspaceFileService, type WorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { OpsAccounts } from './OpsAccounts';
import { OpsBenchmarks } from './OpsBenchmarks';
import { platformLabel } from './opsFormat';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { parseUserProfile, patchUserProfile, type UserProfileSection } from './userProfile';
import { useToastOptional } from '@/components/Toast';

/* ── 步骤 ─────────────────────────────────────────── */

export const OPS_WIZARD_STEPS = [
  'login',
  'direction',
  'material',
  'profile',
  'benchmark',
  'topic',
] as const;

export type OpsWizardStep = (typeof OPS_WIZARD_STEPS)[number];

export const OPS_WIZARD_STEP_COUNT = OPS_WIZARD_STEPS.length;

/** 账号画像在工作区里的位置。模板 manifest 把它列进 `userOwned`。 */
const PROFILE_PATH = '.claude/rules/03-USER.md';

/** 物料落点。skill 契约：`ops/inbox/<批次名>/` + `brief.md`。 */
const INBOX_ROOT = 'ops/inbox';

export interface OpsWizardProps {
  workspace: string;
  /** 台账快照。面板是唯一读它的地方（`useOpsState`），向导不自己再读一遍。 */
  state: OpsState;
  step: OpsWizardStep;
  onStep: (step: OpsWizardStep) => void;
  /** 点「去登录」：父组件切到浏览器接管。 */
  onLogin: (platform: SocialPlatformId) => void;
  /**
   * 把活交给 Agent。**向导里不关面板** —— ⑤⑥ 的产出是台账里长出来的列表，
   * 面板关着人就得自己记走到第几步。
   */
  onSendToAgent: (text: string) => void;
  /** 走完最后一步：父组件记下「这个工作区引导过了」，下次冷启动不再自动弹。 */
  onDone: () => void;
  /**
   * 「以后再说」：父组件记下标记并关掉面板。
   *
   * 这是冷启动向导唯一的逃生阀 —— 一个还没开始经营的工作区不该在每次进
   * 对话时都弹一次六步向导。
   */
  onDefer: () => void;
  /** 新增 / 编辑对标：父组件开它自己的对话框（与台账域共用一套表单）。 */
  onEditBenchmark: (benchmark: OpsBenchmark) => void;
  /** 删除对标：父组件走它自己的确认框。 */
  onDeleteBenchmark: (benchmark: OpsBenchmark) => void;
}

export default function OpsWizard({
  workspace,
  state,
  step,
  onStep,
  onLogin,
  onSendToAgent,
  onDone,
  onDefer,
  onEditBenchmark,
  onDeleteBenchmark,
}: OpsWizardProps) {
  const { t } = useTranslation('chat');
  const toast = useToastOptional();
  const fileService = useWorkspaceFileService(workspace);

  const index = OPS_WIZARD_STEPS.indexOf(step);

  // 草稿放在向导根部，不放在各步里：人来回切步骤时输入框里的话不该消失。
  // 草稿只存「人动过的」那几项 —— 没动过的字段读台账 / 读文件，写回时不碰，
  // 这样用户手改过的同一行不会被向导冲掉。
  const [dirDrafts, setDirDrafts] = useState<Record<string, string>>({});
  const [profileDrafts, setProfileDrafts] = useState<Record<string, string>>({});
  const [materialBrief, setMaterialBrief] = useState('');
  const [batchName, setBatchName] = useState(() => localDate());
  const [materialFiles, setMaterialFiles] = useState<string[]>([]);

  // 已登录的平台 = 有方向的平台。没登录就没方向：方向是「这个号在哪个平台
  // 上说什么」，平台都还没登录就无从说起。
  const signedIn = useMemo(
    () => state.accounts.filter((account) => account.loginState === 'success'),
    [state.accounts],
  );

  const directionBrief = useCallback(
    (platform: SocialPlatformId) => {
      const draft = dirDrafts[platform];
      if (draft !== undefined) return draft;
      return state.directions.find((d) => d.platform === platform)?.brief ?? '';
    },
    [dirDrafts, state.directions],
  );

  /* ── ② 方向原话：失焦即落库 ─────────────────────────
     不自动派工：人可能要连写两个平台再一起交（`DirectionBriefForm` 的同一
     条纪律）。派工在 ④ 出口 —— 方向要拆成五字段得先有画像。 */
  const saveDirection = useCallback(
    async (platform: SocialPlatformId, brief: string) => {
      const next = brief.trim();
      const current = state.directions.find((d) => d.platform === platform)?.brief ?? '';
      if (next === current) return;
      try {
        await opsUpsert(workspace, { kind: 'direction', platform, brief: next });
        toast?.success(t('ops.wizard.direction.saved'));
      } catch (err) {
        toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
      }
    },
    [state.directions, workspace, toast, t],
  );

  /* ── ④ 账号画像：读文件 → 改标签行 → 写回 ──────────────
     `03-USER.md` 归用户，模板收敛永远不写它。所以这里走「读 → 按标签行替换 →
     带 expectedContent 写回」：读到什么改什么，其余段落原样保留；写回带上
     读到的内容做乐观锁，别人刚改过就写失败，而不是覆盖掉。 */
  const [profile, setProfile] = useState<{ sections: UserProfileSection[]; content: string } | null>(
    null,
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const preview = await fileService.readPreview({ path: PROFILE_PATH });
        if (cancelled) return;
        setProfile({ sections: parseUserProfile(preview.content), content: preview.content });
        setProfileError(null);
      } catch (err) {
        if (cancelled) return;
        setProfileError(opsErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileService]);

  const saveProfile = useCallback(async () => {
    if (!profile) return;
    setProfileSaving(true);
    try {
      const next = patchUserProfile(profile.content, profileDrafts);
      await fileService.saveFile({
        path: PROFILE_PATH,
        content: next,
        expectedContent: profile.content,
      });
      setProfile({ sections: parseUserProfile(next), content: next });
      // 写回去了就不该再当草稿：值从文件里读，比草稿更真。
      setProfileDrafts({});
      toast?.success(t('ops.wizard.profile.saved'));
    } catch (err) {
      toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
    } finally {
      setProfileSaving(false);
    }
  }, [fileService, profile, profileDrafts, toast, t]);

  /* ── ③ 物料：选文件 → 投进 ops/inbox/<批次>/ ────────────── */
  const [materialBusy, setMaterialBusy] = useState(false);
  /** 已投递的批次目录。派工时告诉 Agent 物料在哪 —— 空 = 这一轮没投物料。 */
  const [materialDir, setMaterialDir] = useState<string | null>(null);

  const pickMaterial = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ multiple: true });
      if (!picked) return;
      setMaterialFiles(Array.isArray(picked) ? picked : [picked]);
    } catch (err) {
      toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
    }
  }, [toast, t]);

  const deliverMaterial = useCallback(async () => {
    setMaterialBusy(true);
    try {
      const dir = await uniqueBatchDir(fileService, batchName);
      if (materialFiles.length > 0) {
        const copied = await fileService.copyPaths({
          sourcePaths: materialFiles,
          targetDir: dir,
        });
        // 逐文件失败不中断整批，但**必须让用户看见**：全被拒的批次看起来
        // 跟成功一模一样。
        if (copied.errors.length > 0) {
          toast?.error(t('ops.wizard.material.copyFailed', { reason: copied.errors[0] }));
        }
      }
      if (materialBrief.trim()) {
        await fileService.importBase64Files({
          files: [{ name: 'brief.md', content: toBase64(materialBrief) }],
          targetDir: dir,
        });
      }
      setMaterialFiles([]);
      setMaterialDir(dir);
      toast?.success(t('ops.wizard.material.delivered'));
    } catch (err) {
      toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
    } finally {
      setMaterialBusy(false);
    }
  }, [fileService, batchName, materialFiles, materialBrief, toast, t]);

  /* ── 交接给 Agent ────────────────────────────────────
     三段，各有各的时机。派工在 ④ 出口（方向要拆成五字段得先有画像）。 */
  const dispatchAfterProfile = useCallback(async () => {
    const briefs = signedIn
      .map((account) => ({ platform: account.platform, brief: directionBrief(account.platform).trim() }))
      .filter((row) => row.brief.length > 0);
    if (briefs.length === 0) return;
    try {
      // 先在台账里记下「派过工」，再把活派出去。顺序反过来就留下一个说不清
      // 的状态：Agent 已经在整了，台账却没记下派过。
      for (const row of briefs) {
        // 原话和派工**一次写入**：分成两次写就留了一个竞态 —— 派工那条先落地
        // 时台账里还没有原话，Rust 会拒（"no brief to hand to the Agent"），
        // 派工整条丢掉。一次写就没有这个窗口。
        await opsUpsert(workspace, {
          kind: 'direction',
          platform: row.platform,
          brief: row.brief,
          dispatch: true,
        });
      }
    } catch (err) {
      // 没记上派工就不派活：台账与实际脱节比晚一步更糟。
      toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
      return;
    }
    const briefLines = briefs
      .map((row) => `${platformLabel(t, row.platform)}：${row.brief}`)
      .join('\n');
    // 物料只在真的投过的时候才提 —— 派工里写一个空的收件箱路径，Agent 会
    // 去找一个不存在的目录。
    const materialLine = materialDir
      ? `\n\n${t('ops.wizard.dispatch.material', { dir: materialDir })}`
      : '';
    onSendToAgent(
      `${t('ops.wizard.dispatch.afterProfile')}\n\n${briefLines}${materialLine}`,
    );
  }, [signedIn, directionBrief, workspace, materialDir, onSendToAgent, toast, t]);

  const askForBenchmarks = useCallback(() => {
    onSendToAgent(t('ops.wizard.dispatch.findBenchmarks'));
  }, [onSendToAgent, t]);

  const askForTopics = useCallback(() => {
    onSendToAgent(t('ops.wizard.dispatch.findTopics'));
  }, [onSendToAgent, t]);

  /* ── ⑥ 挑一条选题 ─────────────────────────────────── */
  const pickTopic = useCallback(
    async (topic: OpsTopic) => {
      try {
        await opsUpsert(workspace, { kind: 'topic', id: topic.id, status: 'planned' });
        toast?.success(t('ops.wizard.topic.picked'));
      } catch (err) {
        toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
      }
    },
    [workspace, toast, t],
  );

  const goNext = useCallback(() => {
    if (index < OPS_WIZARD_STEPS.length - 1) {
      onStep(OPS_WIZARD_STEPS[index + 1]);
      return;
    }
    onDone();
  }, [index, onStep, onDone]);

  return (
    <div className="ops-wiz">
      <div className="ops-wiz-head">
        <h2>{t(`ops.wizard.step.${step}`)}</h2>
        <p>{t(`ops.wizard.hint.${step}`)}</p>
      </div>

      {step === 'login' && (
        <OpsAccounts workspace={workspace} accounts={state.accounts} onLogin={onLogin} />
      )}

      {step === 'direction' && (
        <section className="ops-card">
          {signedIn.length === 0 ? (
            <p className="ops-empty">{t('ops.wizard.direction.empty')}</p>
          ) : (
            <div className="ops-dir-list">
              {signedIn.map((account) => (
                <label className="ops-dir-item" key={account.platform}>
                  <span className="ops-dir-label">{platformLabel(t, account.platform)}</span>
                  <textarea
                    className="ops-input"
                    rows={3}
                    maxLength={400}
                    value={directionBrief(account.platform)}
                    placeholder={t('ops.wizard.direction.placeholder')}
                    onChange={(e) =>
                      setDirDrafts((prev) => ({ ...prev, [account.platform]: e.target.value }))
                    }
                    onBlur={(e) => void saveDirection(account.platform, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 'material' && (
        <section className="ops-card">
          <div className="ops-field">
            <span>{t('ops.wizard.material.batch')}</span>
            <input
              className="ops-input"
              value={batchName}
              maxLength={40}
              onChange={(e) => setBatchName(e.target.value)}
            />
          </div>
          <div className="ops-field">
            <span>{t('ops.wizard.material.brief')}</span>
            <textarea
              className="ops-input"
              rows={5}
              value={materialBrief}
              placeholder={t('ops.wizard.material.briefPlaceholder')}
              onChange={(e) => setMaterialBrief(e.target.value)}
            />
          </div>
          <div className="ops-wiz-files">
            <button type="button" className="ops-act" onClick={() => void pickMaterial()}>
              {t('ops.wizard.material.choose')}
            </button>
            <span className="ops-meta">
              {materialFiles.length === 0
                ? t('ops.wizard.material.none')
                : t('ops.wizard.material.chosen', { n: materialFiles.length })}
            </span>
          </div>
          <ul className="ops-wiz-filelist">
            {materialFiles.map((path) => (
              <li key={path} title={path}>
                {path.split(/[\\/]/).pop()}
              </li>
            ))}
          </ul>
          <div className="ops-form-actions">
            <button
              type="button"
              className="ops-act solid"
              disabled={materialBusy || (materialFiles.length === 0 && !materialBrief.trim())}
              onClick={() => void deliverMaterial()}
            >
              {t('ops.wizard.material.deliver')}
            </button>
          </div>
        </section>
      )}

      {step === 'profile' && (
        <section className="ops-card">
          {profileError ? (
            <p className="ops-form-error">{t('ops.wizard.profile.missing')}</p>
          ) : !profile ? (
            <p className="ops-status">{t('ops.status.loading')}</p>
          ) : (
            <>
              {profile.sections.map((section) => (
                <div className="ops-wiz-group" key={`${section.key}:${section.fields[0]?.tag ?? ''}`}>
                  <h3 className="ops-wiz-group-title">{section.title || section.key}</h3>
                  <div className="ops-wiz-fields">
                    {section.fields.map((field) => (
                      <label className="ops-field" key={field.tag}>
                        <span>{field.tag}</span>
                        <input
                          className="ops-input"
                          value={profileDrafts[field.tag] ?? field.value}
                          onChange={(e) =>
                            setProfileDrafts((prev) => ({ ...prev, [field.tag]: e.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <p className="ops-form-hint">{t('ops.wizard.profile.restart')}</p>
              <div className="ops-form-actions">
                <button
                  type="button"
                  className="ops-act solid"
                  disabled={profileSaving || Object.keys(profileDrafts).length === 0}
                  onClick={() => void saveProfile()}
                >
                  {t('ops.wizard.profile.save')}
                </button>
                {/* ④ 的出口：画像齐了才派工 —— 方向要拆成五字段得先有画像和
                    语气。派工放在②的出口会拆出一份跟画像打架的方向。 */}
                <button
                  type="button"
                  className="ops-act"
                  onClick={() => void dispatchAfterProfile()}
                >
                  <Sparkles aria-hidden="true" />
                  {t('ops.wizard.dispatch.action')}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step === 'benchmark' && (
        <>
          <div className="ops-wiz-dispatch">
            <button type="button" className="ops-act solid" onClick={askForBenchmarks}>
              <Sparkles aria-hidden="true" />
              {t('ops.wizard.benchmark.ask')}
            </button>
            <span className="ops-form-hint">{t('ops.wizard.benchmark.hint')}</span>
          </div>
          <OpsBenchmarks
            benchmarks={state.benchmarks}
            onEdit={onEditBenchmark}
            onDelete={onDeleteBenchmark}
          />
        </>
      )}

      {step === 'topic' && (
        <>
          <div className="ops-wiz-dispatch">
            <button type="button" className="ops-act solid" onClick={askForTopics}>
              <Sparkles aria-hidden="true" />
              {t('ops.wizard.topic.ask')}
            </button>
            <span className="ops-form-hint">{t('ops.wizard.topic.hint')}</span>
          </div>
          <section className="ops-card">
            {state.topics.length === 0 ? (
              <p className="ops-empty">{t('ops.wizard.topic.empty')}</p>
            ) : (
              <ul className="ops-wiz-topics">
                {state.topics.map((topic) => (
                  <li className="ops-wiz-topic" key={topic.id}>
                    <div className="ops-wiz-topic-head">
                      <span className="ops-wiz-topic-title">{topic.title}</span>
                      <span className="ops-bm-source">{platformLabel(t, topic.platform)}</span>
                    </div>
                    {topic.angle.trim() && <span className="ops-wiz-topic-body">{topic.angle}</span>}
                    <button
                      type="button"
                      className="ops-act"
                      disabled={topic.status === 'planned'}
                      onClick={() => void pickTopic(topic)}
                    >
                      {t('ops.wizard.topic.pick')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <div className="ops-wiz-foot">
        {/* 逃生阀放在最左边：它不是导航的一步，是「我现在不想走这条路」。 */}
        <button type="button" className="ops-act" onClick={onDefer}>
          {t('ops.wizard.defer')}
        </button>
        <span className="ops-sp" />
        <button
          type="button"
          className="ops-act"
          disabled={index === 0}
          onClick={() => onStep(OPS_WIZARD_STEPS[Math.max(0, index - 1)])}
        >
          <ChevronLeft aria-hidden="true" />
          {t('ops.wizard.back')}
        </button>
        <button type="button" className="ops-act solid" onClick={goNext}>
          {index === OPS_WIZARD_STEPS.length - 1 ? t('ops.wizard.finish') : t('ops.wizard.next')}
          {index < OPS_WIZARD_STEPS.length - 1 && <ChevronRight aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/* ── 工具 ─────────────────────────────────────────── */

/**
 * 批次目录名必须唯一。
 *
 * `brief.md` 用 O_CREAT|O_EXCL 写（`files_b64.rs`）：撞名会变成 `brief_1.md`，
 * 而入库的 skill 只读 `brief.md` —— 那份说明就永远读不到。所以在投递前给
 * 批次名加后缀，直到目录是新的。
 */
async function uniqueBatchDir(
  fileService: WorkspaceFileService,
  batch: string,
): Promise<string> {
  const base = batch.trim() || localDate();
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    const dir = `${INBOX_ROOT}/${name}`;
    const { results } = await fileService.checkPaths({ paths: [dir] });
    if (!results[dir]?.exists) return dir;
  }
  return `${INBOX_ROOT}/${base}-${Date.now()}`;
}

/** UTF-8 安全的 base64。`btoa` 直接吃中文会抛 —— 它只认 Latin-1。 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
