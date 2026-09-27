import { useId } from 'react';
import { VerticalProfileEngine, type SurfaceAir } from '../engine/VerticalProfileEngine';
import { dewPointFrom } from '../engine/physics';
import type { AtmosphericProfile } from '../models/AtmosphericProfile';
import { formatDateTime, formatValue } from './format';

interface ProfileViewProps {
  readonly profile: AtmosphericProfile | null;
  /** Aria al suolo reale (osservazione). */
  readonly real: SurfaceAir | null;
  /** Aria al suolo simulata (solo in TEMPESTA LAB). */
  readonly sim?: SurfaceAir | null;
}

const engine = new VerticalProfileEngine();
const W = 340;
const H = 260;
const PAD = { left: 34, right: 70, top: 12, bottom: 26 };

/**
 * PROFILO — sezione verticale semplificata (non uno Skew-T): quota sopra il suolo,
 * temperatura, punto di rugiada e vento dei livelli del PROFILO ATMOSFERICO.
 */
export function ProfileView({ profile, real, sim }: ProfileViewProps) {
  const titleId = useId();
  if (!profile || !real) {
    return (
      <section className="profile" aria-labelledby={titleId}>
        <h3 id={titleId} className="profile__title">PROFILO ATMOSFERICO</h3>
        <p className="profile__missing">DATI VERTICALI INSUFFICIENTI — profilo non disponibile per questo punto.</p>
      </section>
    );
  }
  const analysis = engine.analyze(profile, real, sim ?? real);
  const column = analysis.available ? analysis.environment : engine.environmentColumn(profile, real);
  const points = column?.points ?? [];
  const elevation = profile.elevation ?? 0;
  const topHeight = Math.max(8000, ...points.map((p) => p.height)) + 600;
  const temps = points.flatMap((p) => [p.temperature, p.dewPoint ?? p.temperature]);
  if (sim) temps.push(sim.temperature, dewPointFrom(sim.temperature, sim.relativeHumidity));
  const tMin = Math.floor((Math.min(...temps, -10) - 5) / 10) * 10;
  const tMax = Math.ceil((Math.max(...temps, 10) + 5) / 10) * 10;
  const x = (t: number) => PAD.left + ((t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (z: number) => H - PAD.bottom - (z / topHeight) * (H - PAD.top - PAD.bottom);
  const line = (values: (number | null)[]) =>
    points
      .map((p, i) => (values[i] === null ? null : `${x(values[i] ?? 0).toFixed(1)},${y(p.height).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  const freezing = analysis.available ? analysis.freezingLevel : null;
  const ticksT: number[] = [];
  for (let t = tMin; t <= tMax; t += 10) ticksT.push(t);
  const ticksZ = [0, 2000, 4000, 6000, 8000, 10000].filter((z) => z <= topHeight);
  const simDew = sim ? dewPointFrom(sim.temperature, sim.relativeHumidity) : null;
  // Frecce del vento solo se non si sovrappongono a quella del livello precedente.
  const windShown: boolean[] = [];
  for (let i = 0, lastY = Number.POSITIVE_INFINITY; i < points.length; i++) {
    const p = points[i];
    const py = p ? y(p.height) : 0;
    const show = Boolean(p && p.windSpeed !== null && p.windDirection !== null && lastY - py >= 12);
    if (show) lastY = py;
    windShown.push(show);
  }

  return (
    <section className="profile" aria-labelledby={titleId}>
      <h3 id={titleId} className="profile__title">PROFILO ATMOSFERICO</h3>
      <p className="profile__source">
        {profile.source.providerName} · {profile.source.model} · dato modellistico, non un radiosondaggio · valido{' '}
        <time dateTime={profile.timestamp}>{formatDateTime(profile.timestamp)}</time>
      </p>

      <svg className="profile__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperatura, punto di rugiada e vento in funzione della quota">
        {ticksZ.map((z) => (
          <g key={z}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(z)} y2={y(z)} className="profile__grid" />
            <text x={PAD.left - 4} y={y(z) + 3} className="profile__axis" textAnchor="end">
              {z / 1000}
            </text>
          </g>
        ))}
        {ticksT.map((t) => (
          <text key={t} x={x(t)} y={H - PAD.bottom + 13} className="profile__axis" textAnchor="middle">
            {t}°
          </text>
        ))}
        <text x={4} y={PAD.top + 4} className="profile__axis">km</text>
        {tMin < 0 && tMax > 0 && <line x1={x(0)} x2={x(0)} y1={PAD.top} y2={H - PAD.bottom} className="profile__zero" />}
        {freezing !== null && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(freezing)} y2={y(freezing)} className="profile__freezing" />
            <text x={W - PAD.right - 2} y={y(freezing) - 3} className="profile__label" textAnchor="end">
              0 °C
            </text>
          </g>
        )}
        <polyline points={line(points.map((p) => p.dewPoint))} className="profile__dew" />
        <polyline points={line(points.map((p) => p.temperature))} className="profile__temp" />
        {points.map((p, index) => (
          <g key={p.height}>
            <circle cx={x(p.temperature)} cy={y(p.height)} r={2.2} className="profile__temp-dot" />
            {p.dewPoint !== null && <circle cx={x(p.dewPoint)} cy={y(p.height)} r={2.2} className="profile__dew-dot" />}
            {windShown[index] && p.windSpeed !== null && p.windDirection !== null && (
              <g transform={`translate(${W - PAD.right + 16}, ${y(p.height)})`}>
                <g transform={`rotate(${(p.windDirection + 180) % 360})`}>
                  <line x1={0} y1={7} x2={0} y2={-7} className="profile__wind" />
                  <path d="M -3 -3 L 0 -7 L 3 -3" className="profile__wind" />
                </g>
                <text x={12} y={3} className="profile__axis">
                  {Math.round(p.windSpeed)}
                </text>
              </g>
            )}
          </g>
        ))}
        {sim && simDew !== null && (
          <g className="profile__sim">
            <circle cx={x(sim.temperature)} cy={y(0)} r={4} />
            <circle cx={x(simDew)} cy={y(0)} r={4} />
            <text x={x(sim.temperature) + 6} y={y(0) - 5} className="profile__sim-label">SIM</text>
          </g>
        )}
        <text x={W - 4} y={H - 3} className="profile__axis" textAnchor="end">vento km/h</text>
      </svg>
      <p className="profile__legend">
        <span className="profile__key profile__key--temp">temperatura</span>
        <span className="profile__key profile__key--dew">punto di rugiada</span>
        {sim && <span className="profile__key profile__key--sim">suolo SIM</span>}
        <span>quote sopra il suolo · frecce: verso del vento</span>
      </p>

      {analysis.available ? (
        <dl className="profile__stats">
          <Stat label="Zero termico" value={analysis.freezingLevel === null ? '—' : formatValue(analysis.freezingLevel / 1000, 'km')} />
          <Stat label="Zero bulbo umido ≈" value={analysis.wetBulbZeroApprox === null ? '—' : formatValue(analysis.wetBulbZeroApprox / 1000, 'km')} />
          <Stat label="Gradiente 0–3 km" value={formatValue(analysis.lapseRateLow, '°C/km')} />
          <Stat label="Gradiente 700–500" value={formatValue(analysis.lapseRateMid, '°C/km')} />
          <Stat label="Shear 0–6 km" value={formatValue(analysis.deepLayerShear, 'm/s', 0)} />
          <Stat label="Secchezza 700–500" value={formatValue(analysis.midLevelDryness, '°C', 0)} />
          <Stat label="CAPE (modello)" value={formatValue(profile.cape, 'J/kg', 0)} />
          <Stat label="CIN (modello)" value={formatValue(profile.cin, 'J/kg', 0)} />
        </dl>
      ) : (
        <p className="profile__missing">
          DATI VERTICALI INSUFFICIENTI — mancano: {analysis.missing.join(', ')}.
        </p>
      )}

      <details className="profile__table">
        <summary>Livelli</summary>
        <div className="table-scroll">
          <table>
            <caption>PROFILO ATMOSFERICO del provider (livelli sotto il terreno esclusi)</caption>
            <thead>
              <tr>
                <th scope="col">hPa</th>
                <th scope="col">Quota m</th>
                <th scope="col">T °C</th>
                <th scope="col">Td °C</th>
                <th scope="col">UR %</th>
                <th scope="col">Vento</th>
              </tr>
            </thead>
            <tbody>
              {profile.levels.map((level) => (
                <tr key={level.pressure} className={level.aboveGround ? undefined : 'profile__below'}>
                  <th scope="row">{level.pressure}</th>
                  <td>{level.aboveGround && level.height !== null ? Math.round(level.height - elevation) : 'sotto il suolo'}</td>
                  <td>{level.temperature?.toFixed(1) ?? '—'}</td>
                  <td>{level.dewPoint?.toFixed(1) ?? '—'}</td>
                  <td>{level.relativeHumidity?.toFixed(0) ?? '—'}</td>
                  <td>
                    {level.windSpeed === null ? '—' : `${Math.round(level.windSpeed)} km/h`}
                    {level.windDirection === null ? '' : ` da ${Math.round(level.windDirection)}°`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
