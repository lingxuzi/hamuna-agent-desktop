// 写「运营初始方向」的对话框。
//
// **只有一句话要填。** 方向的结构化是 Agent 的活（用户明确要求「用户提供模糊
// 方向，Agent 自动结构化冷启动」），所以这里不做定位 / 受众 / 支柱这些字段 ——
// 让用户填一张结构化表单，等于把 Agent 该干的活推回给人。
//
// 保存后不自动触发 Agent：人可能要连写两个平台再一起交。触发出在主卡按钮上。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { Field, FormShell, PlatformSelect, SubmitRow } from './OpsForms';

export function DirectionBriefForm({
  workspace,
  platform: initialPlatform,
  brief: initialBrief,
  platformLocked,
  onClose,
  onDone,
}: {
  workspace: string;
  platform: SocialPlatformId;
  brief: string;
  /** 已有方向的平台不能在这里改平台 —— 改平台等于换一条记录。 */
  platformLocked: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [platform, setPlatform] = useState<SocialPlatformId>(initialPlatform);
  const [brief, setBrief] = useState(initialBrief);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = brief.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      // 只发 brief 和 platform。补丁语义下没出现的字段保持原值，所以已有方向
      // 不会被这一句原话抹掉结构化结果。
      await opsUpsert(workspace, { kind: 'direction', platform, brief: brief.trim() });
      onDone(t('ops.toast.directionSaved'));
    } catch (err) {
      setError(opsErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <FormShell title={t('ops.direction.formTitle')} onClose={onClose}>
      {platformLocked ? (
        <Field label={t('ops.form.topic.platform')}>
          <p className="ops-form-hint">{t(`settings:accounts.platform.${platform}`)}</p>
        </Field>
      ) : (
        <PlatformSelect
          label={t('ops.form.topic.platform')}
          value={platform}
          onChange={setPlatform}
        />
      )}
      <Field label={t('ops.direction.brief')}>
        <textarea
          className="ops-input"
          rows={4}
          maxLength={400}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={t('ops.direction.briefPh')}
        />
      </Field>
      <p className="ops-form-hint">{t('ops.direction.briefHint')}</p>
      <SubmitRow
        label={t('ops.form.save')}
        saving={saving}
        onCancel={onClose}
        onSubmit={handleSubmit}
        error={error}
      />
    </FormShell>
  );
}
