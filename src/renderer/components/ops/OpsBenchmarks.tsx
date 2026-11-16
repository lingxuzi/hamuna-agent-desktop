// 对标账号：方向相近、规模更大的参照系。
//
// **为什么它挂在方向域里而不是独立成一个域**：对标是方向的参照物，没有方向
// 的对标只是「收藏了几个别人的号」。所以这张卡长在方向域的网格底部通栏，
// 平台还没立方向时也能先加 —— 冷启动正是这个状态。
//
// **为什么没有「像不像我们」的打分**：打分引擎要的是一套稳定口径，而现在
// 只有 Agent 读公开页后的判断 + 一句理由。理由比分数诚实：分数过期了没人
// 知道它按什么口径算的，理由会被人当场驳回。

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';

import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import {
  OPS_BENCHMARK_SOURCES,
  type OpsBenchmark,
  type OpsBenchmarkSource,
} from '../../../shared/ops';
import { platformLabel } from './opsFormat';
import { Field, FormShell, PlatformSelect, SubmitRow, type SubmitState } from './OpsForms';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import CustomSelect from '@/components/CustomSelect';
import { openExternal } from '@/utils/openExternal';

/* ── 卡片 ─────────────────────────────────────────── */

export interface OpsBenchmarksProps {
  /** 台账里的全部对标账号。 */
  benchmarks: OpsBenchmark[];
  /** 新增：开对话框。 */
  onAdd: () => void;
  /** 编辑：开对话框，带上这条记录。 */
  onEdit: (benchmark: OpsBenchmark) => void;
  /** 删除：走面板的确认框。 */
  onDelete: (benchmark: OpsBenchmark) => void;
  className?: string;
}

export function OpsBenchmarks({
  benchmarks,
  onAdd,
  onEdit,
  onDelete,
  className,
}: OpsBenchmarksProps) {
  const { t } = useTranslation('chat');

  // 按平台分组，组内保持台账里的顺序（人加的在前，Agent 找的在后）。
  const groups = useMemo(() => {
    const map = new Map<SocialPlatformId, OpsBenchmark[]>();
    for (const benchmark of benchmarks) {
      const list = map.get(benchmark.platform);
      if (list) list.push(benchmark);
      else map.set(benchmark.platform, [benchmark]);
    }
    return [...map.entries()];
  }, [benchmarks]);

  return (
    <section className={`ops-card ops-c-bench ${className ?? ''}`}>
      <div className="ops-card-head">
        <h2>{t('ops.benchmark.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">{t('ops.benchmark.meta')}</span>
        <button type="button" className="ops-act" onClick={onAdd}>
          <Plus aria-hidden="true" />
          {t('ops.benchmark.add')}
        </button>
      </div>

      {benchmarks.length === 0 ? (
        <p className="ops-empty">{t('ops.benchmark.empty')}</p>
      ) : (
        groups.map(([platform, list]) => (
          <div className="ops-bm-group" key={platform}>
            <h3 className="ops-bm-group-title">{platformLabel(t, platform)}</h3>
            <div className="ops-bm-grid">
              {list.map((benchmark) => (
                <BenchmarkCard
                  key={benchmark.id}
                  benchmark={benchmark}
                  onEdit={() => onEdit(benchmark)}
                  onDelete={() => onDelete(benchmark)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function BenchmarkCard({
  benchmark,
  onEdit,
  onDelete,
}: {
  benchmark: OpsBenchmark;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('chat');
  const name = benchmark.name.trim() || t('ops.benchmark.noname');

  return (
    <article className="ops-bm-card">
      <div className="ops-bm-card-head">
        <span className="ops-thumb" data-platform={benchmark.platform} aria-hidden="true">
          {name.charAt(0) || '·'}
        </span>
        <span className="ops-bm-name">{name}</span>
        <span className="ops-bm-source">{t(`ops.benchmark.source.${benchmark.source}`)}</span>
      </div>

      <button
        type="button"
        className="ops-bm-link"
        onClick={() => void openExternal(benchmark.profileUrl)}
        title={benchmark.profileUrl}
      >
        <ExternalLink aria-hidden="true" />
        <span>{benchmark.profileUrl}</span>
      </button>

      <span className="ops-bm-text">{benchmark.why.trim() || t('ops.benchmark.noWhy')}</span>
      {benchmark.evidence.trim() && (
        <span className="ops-bm-sub">
          <b>{t('ops.benchmark.evidenceLabel')}</b>
          {benchmark.evidence.trim()}
        </span>
      )}

      <div className="ops-bm-foot">
        <button type="button" className="ops-act" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          {t('ops.benchmark.edit')}
        </button>
        <button type="button" className="ops-act del" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          {t('ops.benchmark.delete')}
        </button>
      </div>
    </article>
  );
}

/* ── 新增 / 编辑对话框 ─────────────────────────────── */

export function BenchmarkForm({
  workspace,
  initial,
  onClose,
  onDone,
}: {
  workspace: string;
  initial?: OpsBenchmark;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [name, setName] = useState(initial?.name ?? '');
  const [platform, setPlatform] = useState<SocialPlatformId>(initial?.platform ?? 'xiaohongshu');
  const [profileUrl, setProfileUrl] = useState(initial?.profileUrl ?? '');
  const [why, setWhy] = useState(initial?.why ?? '');
  const [evidence, setEvidence] = useState(initial?.evidence ?? '');
  const [source, setSource] = useState<OpsBenchmarkSource>(initial?.source ?? 'user');
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });

  // 主页链接是天然键的一半，没它这条记录下次就认不回来 —— 不给建。
  const canSubmit = profileUrl.trim().length > 0 && submit.phase !== 'submitting';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmit({ phase: 'submitting' });
    try {
      await opsUpsert(workspace, {
        kind: 'benchmark',
        ...(initial ? { id: initial.id } : {}),
        platform,
        name: name.trim(),
        profileUrl: profileUrl.trim(),
        why: why.trim(),
        evidence: evidence.trim(),
        source,
      });
      onDone(initial ? t('ops.toast.benchmarkSaved') : t('ops.toast.benchmarkAdded'));
    } catch (err) {
      setSubmit({ phase: 'error', message: opsErrorMessage(err) });
    }
  };

  return (
    <FormShell
      title={initial ? t('ops.form.benchmark.edit') : t('ops.form.benchmark.new')}
      onClose={onClose}
    >
      <Field label={t('ops.form.benchmark.name')}>
        <input
          className="ops-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('ops.form.benchmark.namePh')}
          maxLength={60}
        />
      </Field>
      <PlatformSelect
        label={t('ops.form.benchmark.platform')}
        value={platform}
        onChange={setPlatform}
      />
      <Field label={t('ops.form.benchmark.profileUrl')}>
        <input
          className="ops-input"
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
          placeholder={t('ops.form.benchmark.profileUrlPh')}
        />
      </Field>
      <Field label={t('ops.form.benchmark.why')}>
        <textarea
          className="ops-input"
          rows={2}
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder={t('ops.form.benchmark.whyPh')}
        />
      </Field>
      <Field label={t('ops.form.benchmark.evidence')}>
        <textarea
          className="ops-input"
          rows={2}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder={t('ops.form.benchmark.evidencePh')}
        />
      </Field>
      <Field label={t('ops.form.benchmark.source')}>
        <CustomSelect
          value={source}
          onChange={(v) => setSource(v as OpsBenchmarkSource)}
          options={OPS_BENCHMARK_SOURCES.map((value) => ({
            value,
            label: t(`ops.benchmark.source.${value}`),
          }))}
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
