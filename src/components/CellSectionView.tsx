import type { ConvectiveOutlook } from '../engine/ConvectiveEngine';
import type { SevereOutlook } from '../engine/SevereWeather';
import { formatOffset } from '../simulation/timeline';

interface CellSectionViewProps {
  readonly convection: ConvectiveOutlook;
  readonly severe: SevereOutlook;
  readonly minute: number;
}

const W = 340;
const H = 230;
const GROUND = H - 22;
const TOP_KM = 13;
const CENTER = W / 2;

const y = (metres: number) => GROUND - (Math.min(metres, TOP_KM * 1000) / (TOP_KM * 1000)) * (GROUND - 10);

/** Dimensione relativa della nube per stadio (quota raggiunta e larghezza). */
const CLOUD: Record<string, { top: number; width: number; anvil: boolean }> = {
  INITIATION: { top: 0.4, width: 0.35, anvil: false },
  DEVELOPING: { top: 0.75, width: 0.55, anvil: false },
  MATURE: { top: 1, width: 0.75, anvil: true },
  WEAKENING: { top: 0.9, width: 0.8, anvil: true },
  DISSIPATING: { top: 0.7, width: 0.7, anvil: true },
};

/** Righe di frecce del downburst: ↓ / ↓↓↓ / ↓↓↓↓↓ (profondità relativa, spostamenti orizzontali). */
const BURST_ROWS: readonly { depth: number; offsets: readonly number[] }[] = [
  { depth: 0.15, offsets: [0] },
  { depth: 0.42, offsets: [-12, 0, 12] },
  { depth: 0.68, offsets: [-24, -12, 0, 12, 24] },
  { depth: 1, offsets: [0] },
];

/** Posizioni deterministiche dei chicchi (x relativa, frazione verticale). */
const STONES: readonly [number, number][] = [
  [-0.5, 0.2], [-0.2, 0.55], [0.15, 0.3], [0.45, 0.7], [-0.35, 0.85], [0.3, 0.05], [0, 0.95], [-0.05, 0.4],
];

/**
 * SEZIONE VERTICALE (SIM) della cella: nube, updraft, zero termico, crescita e caduta della
 * grandine, discesa e impatto del downburst. Schema didattico, non in scala orizzontale.
 */
export function CellSectionView({ convection, severe, minute }: CellSectionViewProps) {
  const frame = convection.frames.find((item) => item.minute === minute);
  const hailFrame = severe.hail.frames.find((item) => item.minute === minute);
  const burstFrame = severe.downburst.frames.find((item) => item.minute === minute);
  const vertical = severe.vertical.available ? severe.vertical : null;
  const cellStage = frame?.stage ?? 'NONE';
  const cloud = CLOUD[cellStage];
  const base = vertical?.cloudBase ?? convection.diagnostics.lclHeight ?? 1000;
  const summit = convection.diagnostics.equilibriumHeight ?? 10_000;
  const freezing = vertical?.freezingLevel ?? null;
  const zoneLow = vertical?.isotherm10 ?? null;
  const zoneHigh = vertical?.isotherm30 ?? null;
  const hailStage = hailFrame?.stage ?? 'NONE';
  const burstStage = burstFrame?.stage ?? 'NONE';

  const cloudTop = cloud ? base + (summit - base) * cloud.top : base;
  const halfWidth = cloud ? 120 * cloud.width : 0;
  const yBase = y(base);
  const yTop = y(cloudTop);
  const stoneSize = { NONE: 0, SMALL: 2.2, MEDIUM: 3, LARGE: 4 }[severe.hail.hailSizeClass];

  const hailBand = (low: number, high: number) => [y(high), y(low)] as const;
  let stones: { x: number; y: number; r: number; falling: boolean }[] = [];
  if (hailStage === 'EMBRYO' && freezing !== null) {
    const [top, bottom] = hailBand(freezing, freezing + 1500);
    stones = STONES.slice(0, 5).map(([dx, f]) => ({ x: CENTER + dx * 50, y: top + (bottom - top) * f, r: 1.4, falling: false }));
  } else if ((hailStage === 'GROWING' || hailStage === 'MATURE') && zoneLow !== null) {
    const high = zoneHigh ?? zoneLow + 3000;
    const [top, bottom] = hailBand(zoneLow, Math.min(high, cloudTop));
    const r = hailStage === 'GROWING' ? stoneSize * 0.65 : stoneSize;
    stones = STONES.map(([dx, f]) => ({ x: CENTER + dx * 60, y: top + (bottom - top) * f, r, falling: false }));
  } else if (hailStage === 'FALLING') {
    // I chicchi scendono attraverso la nube e sotto lo zero termico fino al suolo (e fondono in parte).
    const start = freezing !== null ? y(freezing + 800) : yBase;
    stones = STONES.map(([dx, f]) => ({ x: CENTER + 30 + dx * 55, y: start + (GROUND - 8 - start) * f, r: stoneSize * (1 - 0.3 * f), falling: true }));
  }

  const radius = burstFrame?.outflowRadius ?? 0;
  const spread = Math.min(150, 25 + radius * 6);
  const burstX = CENTER + 30;

  return (
    <figure className="section" aria-label={`Sezione verticale simulata a ${formatOffset(minute)} minuti`}>
      <figcaption className="section__title">SEZIONE VERTICALE · SIM · {formatOffset(minute)}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="section__svg" role="img">
        {zoneLow !== null && (hailStage === 'GROWING' || hailStage === 'MATURE') && (
          <rect x={10} width={W - 20} y={y(zoneHigh ?? zoneLow + 3000)} height={y(zoneLow) - y(zoneHigh ?? zoneLow + 3000)} className="section__zone" />
        )}
        {freezing !== null && (
          <g>
            <line x1={10} x2={W - 10} y1={y(freezing)} y2={y(freezing)} className="section__freezing" />
            <text x={W - 12} y={y(freezing) - 3} textAnchor="end" className="section__label">0 °C</text>
          </g>
        )}
        {zoneLow !== null && (hailStage === 'GROWING' || hailStage === 'MATURE') && (
          <text x={W - 12} y={y(zoneHigh ?? zoneLow + 3000) + 11} textAnchor="end" className="section__label section__label--hail">
            crescita grandine (−10…−30 °C)
          </text>
        )}

        {cloud && (
          <g className={`section__cloud section__cloud--${cellStage.toLowerCase()}`}>
            <path
              d={`M ${CENTER - halfWidth} ${yBase}
                  C ${CENTER - halfWidth - 10} ${yBase - 30}, ${CENTER - halfWidth * 0.7} ${yTop + 30}, ${CENTER - halfWidth * 0.45} ${yTop + 8}
                  ${cloud.anvil ? `L ${CENTER - halfWidth * 1.35} ${yTop} L ${CENTER + halfWidth * 1.55} ${yTop} L ${CENTER + halfWidth * 0.5} ${yTop + 8}` : `Q ${CENTER} ${yTop - 12}, ${CENTER + halfWidth * 0.45} ${yTop + 8}`}
                  C ${CENTER + halfWidth * 0.75} ${yTop + 30}, ${CENTER + halfWidth + 10} ${yBase - 30}, ${CENTER + halfWidth} ${yBase} Z`}
            />
            {cellStage !== 'DISSIPATING' && (
              <g className="section__updraft">
                <line x1={CENTER - 20} x2={CENTER - 20} y1={yBase + 12} y2={yTop + 18} />
                <path d={`M ${CENTER - 26} ${yTop + 26} L ${CENTER - 20} ${yTop + 16} L ${CENTER - 14} ${yTop + 26}`} />
                <text x={CENTER - 26} y={(yBase + yTop) / 2} textAnchor="end" className="section__label">updraft</text>
              </g>
            )}
            <text x={CENTER} y={yTop - 4} textAnchor="middle" className="section__label">sommità</text>
          </g>
        )}

        {frame && frame.reflectivity >= 35 && burstStage !== 'IMPACT' && burstStage !== 'OUTFLOW' && (
          <g className="section__rain">
            {[-40, -25, -10, 5, 20, 35, 50].map((dx) => (
              <line key={dx} x1={burstX + dx} x2={burstX + dx - 4} y1={yBase + 4} y2={GROUND - 2} />
            ))}
          </g>
        )}

        {stones.map((stone, index) => (
          <circle
            key={index}
            cx={stone.x}
            cy={stone.y}
            r={Math.max(stone.r, 1.2)}
            className={stone.falling ? 'section__stone section__stone--falling' : 'section__stone'}
            style={{ animationDelay: `${(index % 4) * 0.25}s` }}
          />
        ))}
        {hailStage === 'FALLING' && (
          <text x={CENTER + 95} y={(yBase + GROUND) / 2} className="section__label section__label--hail">caduta chicchi</text>
        )}

        {burstStage !== 'NONE' && (
          <g className={`section__burst section__burst--${burstStage.toLowerCase()}`}>
            {burstStage === 'DEVELOPING' && <ellipse cx={burstX} cy={y(Math.max(base + 1500, 3500))} rx={22} ry={16} className="section__core" />}
            {(burstStage === 'DESCENDING' || burstStage === 'IMPACT') &&
              BURST_ROWS.filter((row) => burstStage === 'IMPACT' || row.depth < 0.7).map((row) => {
                // Righe di frecce: dalla nube (↓) al suolo (↓↓↓↓↓), come una colonna d'aria fredda che scende.
                const top = y(Math.min(Math.max(base + 3000, 6500), cloudTop - 1000));
                const rowY = top + (GROUND - 10 - top) * row.depth;
                return row.offsets.map((dx) => (
                  <g key={`${row.depth}-${dx}`}>
                    <line x1={burstX + dx} x2={burstX + dx} y1={rowY - 16} y2={rowY} />
                    <path d={`M ${burstX + dx - 4} ${rowY - 6} L ${burstX + dx} ${rowY} L ${burstX + dx + 4} ${rowY - 6}`} />
                  </g>
                ));
              })}
            {burstStage === 'IMPACT' && <circle cx={burstX} cy={GROUND} r={5} className="section__impact" />}
            {(burstStage === 'OUTFLOW' || burstStage === 'DISSIPATING' || burstStage === 'IMPACT') && (
              <g>
                {[-1, 1].map((side) => (
                  <g key={side}>
                    <line x1={burstX + side * 10} x2={burstX + side * spread} y1={GROUND - 6} y2={GROUND - 6} />
                    <path
                      d={`M ${burstX + side * (spread - 8)} ${GROUND - 11} L ${burstX + side * spread} ${GROUND - 6} L ${burstX + side * (spread - 8)} ${GROUND - 1}`}
                    />
                  </g>
                ))}
                {burstStage !== 'IMPACT' && <circle cx={burstX} cy={GROUND} r={4} className="section__impact" />}
              </g>
            )}
            <text x={W - 12} y={y(base) - 8} textAnchor="end" className="section__label section__label--burst">
              downburst
            </text>
          </g>
        )}

        <line x1={0} x2={W} y1={GROUND} y2={GROUND} className="section__ground" />
        <text x={8} y={H - 6} className="section__label">suolo</text>
      </svg>
    </figure>
  );
}
