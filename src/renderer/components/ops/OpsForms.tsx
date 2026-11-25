// 运营台账的新建 / 编辑对话框。
//
// 一副壳（OverlayBackdrop + useCloseLayer），三域各自的内容：选题、素材+排期、
// 复盘。规则不走对话框 —— 「写进规则」在建议卡上原地完成（opsWrite 侧一个
// upsert 补丁就够），不开第二层 UI。
//
// 提交走 `cmd_ops_upsert` 补丁语义：编辑只发用户动过的字段，没填的键由 Rust
// 锁内合并保留旧值。**失败不关对话框** —— 输入还在，错误显示在提交行下面，
// 用户改完再点一次；这是 Phase 6 验收里「失败时输入不丢」的落点。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { SOCIAL_PLATFORMS, getSocialPlatformSpec } from '../../../shared/socialPlatforms';
import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import type {
  OpsAspect,
  OpsAsset,
  OpsContentForm,
  OpsReview,
  OpsTopic,
} from '../../../shared/ops';
import { OPS_ASPECTS, canPublishFormTo } from '../../../shared/ops';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import CustomSelect from '@/components/CustomSelect';
import { toLocalDateTimeString } from '@/components/task-center/editors/controls';
import { opsErrorMessage, opsUpsert } from './opsWrite';

interface DialogProps {
  workspace: string;
  onClose: () => void;
}

export type SubmitState = { phase: 'idle' | 'submitting' } | { phase: 'error'; message: string };

/** 三域共用的提交行：取消 + 主按钮 + 失败原因。成功不在这里展示 —— 对话框
 *  直接关，回执交给 toast 与刷新后的台账数字。
 *
 *  `disabled` 由调用方按「这份表单现在能不能提交」给：主键没填时按钮就该是
 *  灰的 —— 一个点了没反应的按钮比一个明确禁用的按钮更让人怀疑是不是坏了。 */
function SubmitRow({
  label,
  saving,
  disabled = false,
  onCancel,
  onSubmit,
  error,
}: {
  label: string;
  saving: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  error: string | null;
}) {
  const { t } = useTranslation('chat');
  return (
    <>
      {error && <p className="ops-form-error">{error}</p>}
      <div className="ops-form-actions">
        <button type="button" className="ops-act" onClick={onCancel}>
          {t('ops.form.cancel')}
        </button>
        <button
          type="button"
          className="ops-act solid"
          disabled={saving || disabled}
          onClick={onSubmit}
        >
          {saving && <Loader2 className="ops-spin" aria-hidden="true" />}
          {label}
        </button>
      </div>
    </>
  );
}

/** 平台下拉。选项从共享注册表来，不另养一份平台清单。 */
function PlatformSelect({
  value,
  onChange,
  label,
}: {
  value: SocialPlatformId;
  onChange: (v: SocialPlatformId) => void;
  label: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <label className="ops-field">
      <span>{label}</span>
      <CustomSelect
        value={value}
        onChange={(v) => onChange(v as SocialPlatformId)}
        options={SOCIAL_PLATFORMS.map((p) => ({ value: p.id, label: t(`accounts.platform.${p.id}`) }))}
      />
    </label>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="ops-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** 一组控件的标题 + 控件。跟 `Field` 的区别只在于外面不是 `<label>`——
 *  里面装的是按钮组时，`<label>` 会把组里第一个按钮认成自己的 control，
 *  点标题就等于点了那个按钮。 */
function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ops-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** 表单壳：遮罩、Esc / Cmd+W 关闭、宽窄自适应都在这一层。 */
function FormShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useCloseLayer(() => {
    onClose();
    return true;
  }, 300);
  return (
    <OverlayBackdrop onClose={onClose} className="z-[300] px-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="ops-form">
        <div className="ops-form-head">
          <h2>{title}</h2>
          <span className="ops-sp" />
        </div>
        {children}
      </div>
    </OverlayBackdrop>
  );
}

/* ── 选题 ─────────────────────────────────────────── */

export function TopicForm({
  workspace,
  initial,
  onClose,
  onDone,
}: DialogProps & { initial?: OpsTopic; onDone: (message: string) => void }) {
  const { t } = useTranslation('chat');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [platform, setPlatform] = useState<SocialPlatformId>(initial?.platform ?? 'xiaohongshu');
  const [angle, setAngle] = useState(initial?.angle ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });

  const canSubmit = title.trim().length > 0 && submit.phase !== 'submitting';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmit({ phase: 'submitting' });
    try {
      await opsUpsert(workspace, {
        kind: 'topic',
        ...(initial ? { id: initial.id } : {}),
        title: title.trim(),
        platform,
        angle: angle.trim(),
        note: note.trim(),
        // 新建走默认值（idea / manual），编辑也不动这两个 —— 状态切换在
        // 列表行上做，来源由打这条选题的入口（热点 / 对标 / 手动）负责。
      });
      onDone(initial ? t('ops.toast.topicSaved') : t('ops.toast.topicAdded'));
    } catch (err) {
      setSubmit({ phase: 'error', message: opsErrorMessage(err) });
    }
  };

  return (
    <FormShell title={initial ? t('ops.form.topic.edit') : t('ops.form.topic.new')} onClose={onClose}>
      <Field label={t('ops.form.topic.title')}>
        <input className="ops-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </Field>
      <PlatformSelect label={t('ops.form.topic.platform')} value={platform} onChange={setPlatform} />
      <Field label={t('ops.form.topic.angle')}>
        <textarea className="ops-input" rows={2} value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={t('ops.form.topic.anglePh')} />
      </Field>
      <Field label={t('ops.form.topic.note')}>
        <textarea className="ops-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ops.form.topic.notePh')} />
      </Field>
      <SubmitRow
        label={t('ops.form.save')}
        saving={submit.phase === 'submitting'}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={handleSubmit}
        error={submit.phase === 'error' ? submit.message : null}
      />
    </FormShell>
  );
}

/* ── 开工：选成品形态 ──────────────────────────────── */

/** 形态选项。顺序按「做出来的东西从重到轻」排：带画面的在前，纯文字在最后。 */
const FORM_OPTIONS: readonly OpsContentForm[] = [
  'image_text',
  'image_only',
  'video_clip',
  'video_aigc',
  'text_only',
];

/**
 * 哪些形态要问画幅。
 *
 * 纯文字没有画面，问画幅就是废动作——多一个必答项就多一次无意义的选择。
 */
const FORM_NEEDS_ASPECT: readonly OpsContentForm[] = [
  'image_text',
  'image_only',
  'video_clip',
  'video_aigc',
];

/**
 * 「开工」对话框：确认形态 → 写台账 → 派工。
 *
 * **画幅在这里问，不在生成中途问**：付费生成前必须由人定死横竖，猜错一次
 * 就是白花的钱、废掉一轮素材。人面板上点一次，之后生成全程无人值守。
 */
export function TopicStartForm({
  workspace,
  topic,
  assets,
  onClose,
  onStart,
}: DialogProps & {
  topic: OpsTopic;
  /** 已经挂在这条选题下面的素材。重试时复用它，不重复建。 */
  assets: OpsAsset[];
  /** 台账写成功后调用：派工生成。写失败不会走到这里。 */
  onStart: (form: OpsContentForm, aspect: OpsAspect | null, assetId: string) => void;
}) {
  const { t } = useTranslation('chat');
  const spec = getSocialPlatformSpec(topic.platform);
  const [form, setForm] = useState<OpsContentForm>(
    () => FORM_OPTIONS.find((opt) => canPublishFormTo(spec, opt)) ?? 'image_text',
  );
  const [aspect, setAspect] = useState<OpsAspect | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });

  const needsAspect = FORM_NEEDS_ASPECT.includes(form);
  /** 这个平台收不收这种形态。收不了就不让开工 —— 生成完才发现发不出去等于白花钱。 */
  const platformTakesForm = canPublishFormTo(spec, form);
  const canSubmit =
    submit.phase !== 'submitting' &&
    platformTakesForm &&
    (!needsAspect || aspect !== null);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmit({ phase: 'submitting' });
    try {
      // 状态 + 形态 + 画幅**一次写入**：分成两次写，中间崩掉会留下
      // 「已开工但没形态」的记录——那种记录既不能再开工，也不能做稿。
      await opsUpsert(workspace, {
        kind: 'topic',
        id: topic.id,
        status: 'planned',
        form,
        formAspect: needsAspect ? aspect : null,
      });
      // 素材记录也在这一步建立，并把 id 交给 Agent。
      //
      // 之前没人建它：skill 里只有 `ops update asset <id>`，而那个 id 从来
      // 没人产出来 —— Agent 拿到派工后第一步就没有落点，只能自己去 `ops add`
      // 再回头找 id，中途对不上就静默写歪。id 由这里产出，Agent 只管往
      // `ops/assets/<assetId>/` 里放文件。
      //
      // 同一条选题重试开工（形态换了 / 上一轮崩了）复用已有素材：新建会让
      // 面板上出现两条挂同一选题的素材，发布时不知道发哪条。
      const existing = assets.find((asset) => asset.topicId === topic.id);
      const { id: assetId } = existing
        ? { id: existing.id }
        : await opsUpsert(workspace, {
            kind: 'asset',
            title: topic.title,
            platform: topic.platform,
            topicId: topic.id,
          });
      onStart(form, needsAspect ? aspect : null, assetId);
      onClose();
    } catch (err) {
      setSubmit({ phase: 'error', message: opsErrorMessage(err) });
    }
  };

  return (
    <FormShell title={t('ops.form.start.title')} onClose={onClose}>
      <p className="ops-form-hint">{t('ops.form.start.hint', { title: topic.title })}</p>
      <Group label={t('ops.form.start.form')}>
        <div className="ops-choice" role="radiogroup" aria-label={t('ops.form.start.form')}>
          {FORM_OPTIONS.map((opt) => {
            const unsupported = !canPublishFormTo(spec, opt);
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={form === opt}
                aria-disabled={unsupported}
                className="ops-choice-item"
                data-active={form === opt && !unsupported ? '' : undefined}
                data-unsupported={unsupported ? '' : undefined}
                onClick={() => setForm(opt)}
              >
                <strong>{t(`ops.form.pick.${opt}.title`)}</strong>
                <small>
                  {unsupported
                    ? t('ops.form.start.unsupported', {
                        platform: t(`settings:accounts.platform.${topic.platform}`),
                      })
                    : t(`ops.form.pick.${opt}.desc`)}
                </small>
              </button>
            );
          })}
        </div>
      </Group>
      {needsAspect && (
        <Group label={t('ops.form.start.aspect')}>
          <div className="ops-choice-inline" role="radiogroup" aria-label={t('ops.form.start.aspect')}>
            {OPS_ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={aspect === a}
                className="ops-choice-pill"
                data-active={aspect === a ? '' : undefined}
                onClick={() => setAspect(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </Group>
      )}
      <SubmitRow
        label={t('ops.form.start.submit')}
        saving={submit.phase === 'submitting'}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={handleSubmit}
        error={submit.phase === 'error' ? submit.message : null}
      />
    </FormShell>
  );
}

/* ── 素材 + 排期 ──────────────────────────────────── */

export function AssetForm({
  workspace,
  initial,
  topics,
  onClose,
  onDone,
}: DialogProps & { initial?: OpsAsset; topics: OpsTopic[]; onDone: (message: string) => void }) {
  const { t } = useTranslation('chat');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [platform, setPlatform] = useState<SocialPlatformId>(initial?.platform ?? 'douyin');
  const [topicId, setTopicId] = useState(initial?.topicId ?? '');
  const [product, setProduct] = useState(initial?.product ?? '');
  const [cta, setCta] = useState(initial?.cta ?? '');
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt ? toLocalDateTimeString(new Date(initial.scheduledAt)) : '',
  );
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });

  const canSubmit = title.trim().length > 0 && submit.phase !== 'submitting';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmit({ phase: 'submitting' });
    try {
      await opsUpsert(workspace, {
        kind: 'asset',
        ...(initial ? { id: initial.id } : {}),
        title: title.trim(),
        platform,
        product: product.trim(),
        cta: cta.trim(),
        // 没选挂靠选题 = 手动导入的稿件；补丁里发 null 显式解除挂靠，
        // 不发（键缺席）则保留旧值 —— 两种语义都代码里写死，不靠调用方记。
        ...(initial ? { topicId: topicId || null } : topicId ? { topicId } : {}),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      onDone(initial ? t('ops.toast.assetSaved') : t('ops.toast.assetAdded'));
    } catch (err) {
      setSubmit({ phase: 'error', message: opsErrorMessage(err) });
    }
  };

  return (
    <FormShell title={initial ? t('ops.form.asset.edit') : t('ops.form.asset.new')} onClose={onClose}>
      <Field label={t('ops.form.asset.title')}>
        <input className="ops-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </Field>
      <Field label={t('ops.form.asset.topic')}>
        <CustomSelect
          value={topicId}
          onChange={setTopicId}
          placeholder={t('ops.form.asset.noTopic')}
          options={[
            { value: '', label: t('ops.form.asset.noTopic') },
            ...topics.map((topic) => ({ value: topic.id, label: topic.title })),
          ]}
        />
      </Field>
      <PlatformSelect label={t('ops.form.asset.platform')} value={platform} onChange={setPlatform} />
      <Field label={t('ops.form.asset.product')}>
        <input
          className="ops-input"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder={t('ops.form.asset.productPh')}
          maxLength={80}
        />
      </Field>
      <Field label={t('ops.form.asset.cta')}>
        <input
          className="ops-input"
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          placeholder={t('ops.form.asset.ctaPh')}
          maxLength={80}
        />
      </Field>
      <Field label={t('ops.form.asset.scheduledAt')}>
        <input
          type="datetime-local"
          className="ops-input"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </Field>
      <SubmitRow
        label={t('ops.form.save')}
        saving={submit.phase === 'submitting'}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={handleSubmit}
        error={submit.phase === 'error' ? submit.message : null}
      />
    </FormShell>
  );
}

/* ── 复盘 ─────────────────────────────────────────── */

export function ReviewForm({
  workspace,
  assets,
  initial,
  onClose,
  onDone,
}: DialogProps & { initial?: OpsReview; assets: OpsAsset[]; onDone: (message: string) => void }) {
  const { t } = useTranslation('chat');
  const [assetId, setAssetId] = useState(initial?.assetId ?? assets[0]?.id ?? '');
  const [views, setViews] = useState(initial ? String(initial.metrics.views) : '');
  const [likes, setLikes] = useState(initial ? String(initial.metrics.likes) : '');
  const [comments, setComments] = useState(initial ? String(initial.metrics.comments) : '');
  const [completion, setCompletion] = useState(
    initial?.metrics.completionRate != null ? String(Math.round(initial.metrics.completionRate * 100)) : '',
  );
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });

  const canSubmit = assetId !== '' && submit.phase !== 'submitting';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmit({ phase: 'submitting' });
    try {
      const asset = assets.find((a) => a.id === assetId);
      // 复盘补丁只发数字字段：其余指标（shares / saves / followers）没填就
      // 保持原值或 0，不在前端替用户猜。
      const metrics = {
        views: Math.max(0, Number(views) || 0),
        likes: Math.max(0, Number(likes) || 0),
        comments: Math.max(0, Number(comments) || 0),
        ...(completion.trim() !== '' ? { completionRate: Math.min(1, Math.max(0, Number(completion) / 100)) } : {}),
      };
      await opsUpsert(workspace, {
        kind: 'review',
        ...(initial ? { id: initial.id } : {}),
        assetId,
        platform: asset?.platform ?? 'douyin',
        publishedAt: asset?.publishedAt ?? asset?.scheduledAt ?? new Date().toISOString(),
        metrics,
      });
      onDone(initial ? t('ops.toast.reviewSaved') : t('ops.toast.reviewAdded'));
    } catch (err) {
      setSubmit({ phase: 'error', message: opsErrorMessage(err) });
    }
  };

  return (
    <FormShell title={initial ? t('ops.form.review.edit') : t('ops.form.review.new')} onClose={onClose}>
      <Field label={t('ops.form.review.asset')}>
        {assets.length === 0 ? (
          <p className="ops-form-hint">{t('ops.form.review.noAssets')}</p>
        ) : (
          <CustomSelect
            value={assetId}
            onChange={setAssetId}
            options={assets.map((a) => ({ value: a.id, label: a.title }))}
          />
        )}
      </Field>
      <div className="ops-form-grid">
        <Field label={t('ops.form.review.views')}>
          <input className="ops-input" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} />
        </Field>
        <Field label={t('ops.form.review.likes')}>
          <input className="ops-input" inputMode="numeric" value={likes} onChange={(e) => setLikes(e.target.value)} />
        </Field>
        <Field label={t('ops.form.review.comments')}>
          <input className="ops-input" inputMode="numeric" value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
        <Field label={t('ops.form.review.completion')}>
          <input
            className="ops-input"
            inputMode="decimal"
            value={completion}
            onChange={(e) => setCompletion(e.target.value)}
            placeholder="0–100"
          />
        </Field>
      </div>
      <SubmitRow
        label={t('ops.form.save')}
        saving={submit.phase === 'submitting'}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={handleSubmit}
        error={submit.phase === 'error' ? submit.message : null}
      />
    </FormShell>
  );
}

export { Field, PlatformSelect, FormShell, SubmitRow };
