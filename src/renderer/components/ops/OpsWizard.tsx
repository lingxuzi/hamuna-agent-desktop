// 冷启动向导：运营台的一个模式，取代 `/BOOTSTRAP`。
//
// **为什么是运营台的一个模式，不是另一块 UI**：登录要接管原生浏览器，物料要
// 写工作区，方向 / 对标 / 选题要写台账 —— 这三样东西的落点运营台全都有。
// 再造一块壳，等于把「浏览器接管」「台账写入」「工作区文件 IO」各做第二遍。
//
// **三步的分工**：① 登录 ② 方向原话 ③ 物料 —— 全是「只有人能做」的部分。
// 其余交给 Agent：账号画像里那几项只有人知道（语气、禁用词、格式硬要求、
// 节奏），Sino 逐条问、答完自己写回 `03-USER.md`；对标、选题、做稿、排期
// 是它读公开页 / 搜热点得出的活，人在对话里点头就行。
//
// **三步走完自动派工**：不需要人再点一次「开工」。走完第 ③ 步就把活交出去，
// 面板随之关掉 —— 接下来是 Sino 在对话区逐条提问，人得看得见那张提问卡。

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import type { OpsState } from '../../../shared/ops';
import { OPS_MATERIALS_RELATIVE_DIR } from '../../../shared/ops';
import { localDate } from '../../../shared/logTime';
import { useWorkspaceFileService, type WorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { OpsAccounts } from './OpsAccounts';
import { platformLabel } from './opsFormat';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { useToastOptional } from '@/components/Toast';

/* ── 步骤 ─────────────────────────────────────────── */

export const OPS_WIZARD_STEPS = ['login', 'direction', 'material'] as const;

export type OpsWizardStep = (typeof OPS_WIZARD_STEPS)[number];

export const OPS_WIZARD_STEP_COUNT = OPS_WIZARD_STEPS.length;

export interface OpsWizardProps {
  workspace: string;
  /** 台账快照。面板是唯一读它的地方（`useOpsState`），向导不自己再读一遍。 */
  state: OpsState;
  step: OpsWizardStep;
  onStep: (step: OpsWizardStep) => void;
  /** 点「去登录」：父组件切到浏览器接管。 */
  onLogin: (platform: SocialPlatformId) => void;
  /**
   * 把活交给 Agent。
   *
   * **派工之后面板就关了**：Agent 的提问卡在对话区，而运营台是浮在对话区上的
   * —— 面板盖着，用户看不见问题就答不了，而提问正是派工之后唯一要做的事。
   */
  onSendToAgent: (text: string) => void;
  /** 走完最后一步：父组件记下「这个工作区引导过了」，下次冷启动不再自动弹。 */
  onDone: () => void;
  /**
   * 「以后再说」：父组件记下标记并关掉面板。
   *
   * 这是冷启动向导唯一的逃生阀 —— 一个还没开始经营的工作区不该在每次进
   * 对话时都弹一次三步向导。
   */
  onDefer: () => void;
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
}: OpsWizardProps) {
  const { t } = useTranslation('chat');
  const toast = useToastOptional();
  const fileService = useWorkspaceFileService(workspace);

  const index = OPS_WIZARD_STEPS.indexOf(step);

  // 草稿放在向导根部，不放在各步里：人来回切步骤时输入框里的话不该消失。
  // 草稿只存「人动过的」那几项 —— 没动过的字段读台账 / 读文件，写回时不碰，
  // 这样用户手改过的同一行不会被向导冲掉。
  const [dirDrafts, setDirDrafts] = useState<Record<string, string>>({});
  const [materialBrief, setMaterialBrief] = useState('');
  const [materialFiles, setMaterialFiles] = useState<string[]>([]);
  /** 派工中。防止连点两下「完成」= 派两次工（两遍提问、两遍找对标）。 */
  const [dispatching, setDispatching] = useState(false);

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
     条纪律）。派工在三步走完之后统一交 —— 方向要拆成五字段得先有画像，
     而画像那几项由 Agent 逐条问。 */
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

  /* ── ③ 物料：选文件 → 投进 ops/materials/ 并逐文件登记 ──────────
     文件落在**一个平面目录**里（不再按批次分文件夹）：一条记录描述一个文件，
     合进「批次」就又回到「Agent 不知道哪张图是哪个」。说明文字单独写成一个
     `brief-<日期>.md`，也一起登记。 */
  const [materialBusy, setMaterialBusy] = useState(false);
  /** 这一轮真的投过东西。派工时告诉 Agent 去 `ops/materials` 收物料。 */
  const [materialDelivered, setMaterialDelivered] = useState(false);

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

  /**
   * 逐文件登记。建记录失败不回滚文件（文件已经在盘上、面板也列得出来），
   * 但必须说出来 —— 只落文件不建记录，就是「面板看得见、Agent 查不到」。
   */
  const registerMaterials = useCallback(
    async (paths: string[]): Promise<string[]> => {
      const failures: string[] = [];
      for (const path of paths) {
        try {
          await opsUpsert(workspace, { kind: 'material', path });
        } catch (err) {
          failures.push(`${path}: ${opsErrorMessage(err)}`);
        }
      }
      return failures;
    },
    [workspace],
  );

  const deliverMaterial = useCallback(async () => {
    setMaterialBusy(true);
    try {
      const failures: string[] = [];
      const copiedPaths: string[] = [];
      if (materialFiles.length > 0) {
        const copied = await fileService.copyPaths({
          sourcePaths: materialFiles,
          targetDir: OPS_MATERIALS_RELATIVE_DIR,
        });
        // 逐文件失败不中断整批，但**必须让用户看见**：全被拒的批次看起来
        // 跟成功一模一样。
        failures.push(...copied.errors);
        copiedPaths.push(...copied.copiedFiles.map((file) => file.targetPath));
      }
      if (materialBrief.trim()) {
        // 文件名带日期：`brief.md` 是 O_EXCL 写的，撞名会变成 `brief_1.md`，
        // 而入库的 skill 只读固定名字的那份，说明就永远读不到。日期撞了再加序号。
        const name = await uniqueBriefName(fileService);
        const imported = await fileService.importBase64Files({
          files: [{ name, content: toBase64(materialBrief) }],
          targetDir: OPS_MATERIALS_RELATIVE_DIR,
        });
        // 返回的就是工作区相对路径（`ops/materials/brief-<日期>.md`）。
        copiedPaths.push(...imported.files);
      }
      failures.push(...(await registerMaterials(copiedPaths)));
      if (failures.length > 0) {
        toast?.error(t('ops.wizard.material.copyFailed', { reason: failures[0] }));
      }
      setMaterialFiles([]);
      setMaterialDelivered(copiedPaths.length > 0);
      if (copiedPaths.length > 0) toast?.success(t('ops.wizard.material.delivered'));
    } catch (err) {
      toast?.error(t('ops.toast.saveFailed', { reason: opsErrorMessage(err) }));
    } finally {
      setMaterialBusy(false);
    }
  }, [fileService, materialFiles, materialBrief, registerMaterials, toast, t]);

  /* ── 交接给 Agent ────────────────────────────────────
     三步走完自动派工：方向原话 + 物料 + 一份「接下来做什么」的清单。

     **画像那几项不猜** —— 语气、禁用词、格式硬要求、节奏只有人知道，让
     Agent 逐条问、答完自己写回 `03-USER.md`。人不用再填一张 22 字段的表，
     画像也不会被编出来。 */
  const dispatchAfterMaterial = useCallback(async () => {
    const briefs = signedIn
      .map((account) => ({ platform: account.platform, brief: directionBrief(account.platform).trim() }))
      .filter((row) => row.brief.length > 0);
    if (briefs.length === 0) {
      // 没有方向就没有「往哪儿开工」——Agent 找的对标会跑偏。回到第 ② 步，
      // 而不是把活交出去让 Agent 空转。
      toast?.warning(t('ops.wizard.direction.missing'));
      onStep('direction');
      return false;
    }
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
      return false;
    }
    const briefLines = briefs
      .map((row) => `${platformLabel(t, row.platform)}：${row.brief}`)
      .join('\n');
    // 物料只在真的投过的时候才提 —— 派工里写一个空的目录路径，Agent 会
    // 去找一个不存在的地方。
    const materialLine = materialDelivered
      ? `${t('ops.wizard.dispatch.material', { dir: OPS_MATERIALS_RELATIVE_DIR })}\n`
      : '';
    onSendToAgent(
      t('ops.wizard.dispatch.afterMaterial', {
        briefs: briefLines,
        material: materialLine,
      }),
    );
    return true;
  }, [signedIn, directionBrief, workspace, materialDelivered, onSendToAgent, onStep, toast, t]);

  const goNext = useCallback(() => {
    if (index < OPS_WIZARD_STEPS.length - 1) {
      onStep(OPS_WIZARD_STEPS[index + 1]);
      return;
    }
    // 走完第 ③ 步 = 自动派工。不让人再点一次「开工」—— 那一步本来就是必然的，
    // 多一次点击就多一次「我到底派没派出去」的犹豫。
    if (dispatching) return;
    setDispatching(true);
    void dispatchAfterMaterial().then((dispatched) => {
      setDispatching(false);
      if (!dispatched) return;
      toast?.success(t('ops.wizard.dispatched'));
      onDone();
    });
  }, [index, onStep, dispatching, dispatchAfterMaterial, onDone, toast, t]);

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
        <button type="button" className="ops-act solid" disabled={dispatching} onClick={goNext}>
          {index === OPS_WIZARD_STEPS.length - 1 ? t('ops.wizard.finish') : t('ops.wizard.next')}
          {index < OPS_WIZARD_STEPS.length - 1 && <ChevronRight aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/* ── 工具 ─────────────────────────────────────────── */

/**
 * `brief-<日期>.md` 的名字必须唯一。
 *
 * 导入文件的写入是 O_CREAT|O_EXCL（`files_b64.rs`）：撞名会变成 `brief-1.md`，
 * 而入库的 skill 按文件名找那张说明，认不出就永远读不到。所以先探一次。
 */
async function uniqueBriefName(fileService: WorkspaceFileService): Promise<string> {
  const base = `brief-${localDate()}`;
  const { results } = await fileService.checkPaths({
    paths: [`${OPS_MATERIALS_RELATIVE_DIR}/${base}.md`],
  });
  if (!results[`${OPS_MATERIALS_RELATIVE_DIR}/${base}.md`]?.exists) return `${base}.md`;
  return `${base}-${Date.now()}.md`;
}

/** UTF-8 安全的 base64。`btoa` 直接吃中文会抛 —— 它只认 Latin-1。 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
