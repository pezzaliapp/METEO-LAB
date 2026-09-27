export interface Metric {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

export function MetricGrid({ metrics, tag }: { readonly metrics: readonly Metric[]; readonly tag: 'LIVE' | 'SIM' | 'ULTIMA' }) {
  return (
    <dl className="metrics">
      {metrics.map((metric) => (
        <div className="metric" key={metric.key}>
          <dt className="metric__label">
            {metric.label}
            <span className={`metric__tag metric__tag--${tag.toLowerCase()}`}>{tag}</span>
          </dt>
          <dd className="metric__value">{metric.value}</dd>
          {metric.detail && <dd className="metric__detail">{metric.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
