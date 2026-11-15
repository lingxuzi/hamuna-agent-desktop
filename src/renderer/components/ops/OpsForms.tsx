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

import { SOCIAL_PLATFORMS } from '../../../shared/socialPlatforms';
import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import type { OpsAsset, OpsReview, OpsTopic } from '../../../shared/ops';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import CustomSelect from '@/components/CustomSelect';
import { toLocalDateTimeString } from '@/components/task-center/editors/controls';
import { opsErrorMessage, opsUpsert } from './opsWrite';

interface DialogProps {
  workspace: string;
  onClose: () => void;
}

type SubmitState = { phase: 'idle' | 'submitting' } | { phase: 'error'; message: string };

/** 三域共用的提交行：取消 + 主按钮 + 失败原因。成功不在这里展示 —— 对话框
 *  直接关，回执交给 toast 与刷新后的台账数字。 */
function SubmitRow({
  label,
  saving,
  onCancel,
  onSubmit,
  error,
}: {
  label: string;
  saving: boolean;
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
        <button type="button" className="ops-act solid" disabled={saving} onClick={onSubmit}>
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
        onCancel={onClose}
        onSubmit={handleSubmit}
        error={submit.phase === 'error' ? submit.message : null}
      />
    </FormShell>
  );
}

export { Field, PlatformSelect, FormShell, SubmitRow };
