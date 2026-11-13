import { useTranslation } from 'react-i18next';

import type { OpsMetric } from '../../../shared/ops-derive';
import { formatMetric } from './opsFormat';

interface OpsHeroProps {
  /** 结论句：由调用方按域拼好（含数字与产品名），这里只负责排版。 */
  lead: React.ReactNode;
  metrics: OpsMetric[];
  /** 动作行。CSS（`.ops-acts`）早已备好槽位，缺省不渲染——只读场景不给空按钮。 */
  actions?: React.ReactNode;
}

/**
 * Hero：一句结论 + 三等分指标带（+ 动作行）。
 *
 * 结论句在调用方拼，因为四个域的句式不同（待加工几条 / 本周排了几条 / 带了多少
 * 播放），塞进一个模板会变成四种条件分支。这里只管排版。
 */
export default function OpsHero({ lead, metrics, actions }: OpsHeroProps) {
  const { t, i18n } = useTranslation('chat');
  return (
    <section className="ops-hero">
      <div className="ops-hero-row">
        <div className="ops-hero-copy">
          <h1>{lead}</h1>
          {actions && <div className="ops-acts">{actions}</div>}
        </div>
        <dl className="ops-metrics">
          {metrics.map((metric) => {
            const parts = formatMetric(metric, i18n.language);
            return (
              <div key={metric.key}>
                <dt>{t(metric.key)}</dt>
                <dd>
                  {parts.text}
                  {parts.unit && <small>{parts.unit}</small>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
