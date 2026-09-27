import { TIMELINE_MINUTES } from '../simulation/timeline';
import { moistAdiabaticLapseRate, type ConvectiveOutlook, type GeoPoint } from './ConvectiveEngine';
import { clamp, relativeHumidityFrom, round, saturationMixingRatio, smoothstep } from './physics';
import { coreCenter, reachesMaturity, type PhysicalFactor } from './SevereCommon';
import { temperatureAt, wetBulbStull, type ProfileColumn, type VerticalAnalysis } from './VerticalProfileEngine';

/**
 * DownburstEngine — DOWNBURST LAB. Modello DIDATTICO, non operativo: nessuna previsione.
 *
 * Una corrente discendente accelera quando l'aria diventa più fredda (più densa)
 * dell'ambiente: evaporazione e fusione della precipitazione la raffreddano,
 * il peso della precipitazione la trascina (precipitation loading).
 *
 *  1. DCAPE didattica (J/kg): la particella parte dal livello del profilo con
 *     temperatura potenziale equivalente minima (aria più secca e fredda, fra ~500 m e
 *     500 hPa), viene portata alla sua temperatura di bulbo umido (Stull 2011) e scende
 *     restando satura lungo l'adiabatica satura fino al suolo. Si integra la spinta
 *     negativa g·(Tamb − Tp)/Tamb. DCAPE > 1000 J/kg è spesso associata a correnti
 *     discendenti forti (es. Gilmore & Wicker 1998). Fattore = smoothstep(DCAPE, 400, 1200).
 *  2. PRECIPITATION LOADING: nucleo di precipitazione intenso (riflettività di picco
 *     della cella). Fattore = smoothstep(dBZ, 45, 60).
 *  3. EVAPORAZIONE: aria secca sotto la base delle nubi (downburst "secchi", base alta:
 *     Wakimoto 1985) OPPURE aria secca a 700–500 hPa trascinata nella nube (downburst
 *     "umidi"). Fattore = max(sotto-nube × (0,5 + 0,5·base alta), quota media), con
 *     sotto-nube = smoothstep(T − Td, 3, 12) °C, base alta = smoothstep(LCL, 500, 2500) m,
 *     quota media = smoothstep(T − Td, 5, 15) °C.
 *  4. GRADIENTE 0–3 km: con gradienti vicini all'adiabatica secca (> 8 °C/km) l'aria
 *     che scende resta più fredda dell'ambiente fino al suolo. Fattore = smoothstep(Γ, 6, 8,5).
 *  5. INTENSITÀ DELLA CELLA: serve una cella matura (il downburst nasce dal collasso del
 *     nucleo di precipitazione).
 *
 *  downburstPotential = loading × DCAPE × (0,5 + 0,5·evaporazione) × (0,6 + 0,4·gradiente)
 *  È un INDICE DIDATTICO 0…1, non una probabilità calibrata.
 *
 *  Velocità dell'outflow (solo per la classe): w = ½·√(2·DCAPE) (teoria della particella,
 *  dimezzata) × (0,5 + 0,5·loading) + metà della velocità della cella.
 *  Classi: < 17 m/s WEAK (sotto la burrasca, Beaufort 8), 17–25,7 MODERATE,
 *  ≥ 25,7 m/s STRONG (50 nodi, soglia "severe" del NWS). Non sono velocità previste.
 *
 *  Estensione dell'outflow: all'impatto ~1,5 km (microburst < 4 km, Fujita 1985),
 *  poi il fronte di raffica avanza a ~0,6 volte la velocità dell'outflow (corrente di densità).
 */

export type DownburstStage = 'NONE' | 'DEVELOPING' | 'DESCENDING' | 'IMPACT' | 'OUTFLOW' | 'DISSIPATING';
export type OutflowSpeedClass = 'WEAK' | 'MODERATE' | 'STRONG';
export type DownburstFactorKey = 'dcape' | 'loading' | 'evaporation' | 'lapseRate' | 'cell';

export interface DownburstFrame {
  readonly minute: number;
  readonly stage: DownburstStage;
  /** km — raggio del fronte di raffica sulla mappa (0 = non visibile). */
  readonly outflowRadius: number;
  readonly impactPoint: GeoPoint;
}

export interface DownburstOutlook {
  readonly available: boolean;
  readonly missing: readonly string[];
  readonly downburstPotential: number;
  readonly occurs: boolean;
  readonly outflowSpeedClass: OutflowSpeedClass | null;
  /** km — raggio massimo raggiunto dal fronte di raffica. */
  readonly outflowRadius: number;
  /** J/kg — DCAPE didattica. */
  readonly dcape: number;
  readonly factors: Readonly<Record<DownburstFactorKey, PhysicalFactor>>;
  /** Contributo dominante all'evaporazione. */
  readonly evaporationSource: 'sub-cloud' | 'mid-level' | 'both' | null;
  readonly limitingFactor: DownburstFactorKey | null;
  readonly impactPoint: GeoPoint | null;
  readonly frames: readonly DownburstFrame[];
}

export const DOWNBURST_REFERENCE = {
  dcapeLow: 400,
  dcapeHigh: 1200,
  loadingLow: 45,
  loadingHigh: 60,
  subCloudMoist: 3,
  subCloudDry: 12,
  baseLow: 500,
  baseHigh: 2500,
  midMoist: 5,
  midDry: 15,
  lapseLow: 6,
  lapseSteep: 8.5,
  galeSpeed: 17,
  severeSpeed: 25.7,
  impactRadius: 1.5,
  gustFrontFactor: 0.6,
} as const;

const G = 9.80665;
const RD = 287.04;
const CP = 1005.7;
const LV = 2.501e6;
const KELVIN = 273.15;

/** Temperatura potenziale equivalente approssimata (K): (T + Lv·r/cp)·(1000/p)^0,2854. */
function equivalentPotentialTemperature(temperature: number, dewPoint: number, pressure: number): number {
  const r = saturationMixingRatio(dewPoint, pressure);
  return (temperature + KELVIN + (LV * r) / CP) * (1000 / pressure) ** 0.2854;
}

/** DCAPE didattica sulla colonna dell'esperimento (J/kg), con il livello di partenza. */
export function downdraftCape(column: ProfileColumn, surfacePressure: number): { dcape: number; sourceHeight: number | null } {
  const candidates = column.points.filter(
    (p) => p.height >= 500 && p.pressure !== null && p.pressure >= 500 && p.dewPoint !== null,
  );
  if (candidates.length === 0) return { dcape: 0, sourceHeight: null };
  const source = candidates.reduce((min, p) =>
    equivalentPotentialTemperature(p.temperature, p.dewPoint ?? p.temperature, p.pressure ?? 500) <
    equivalentPotentialTemperature(min.temperature, min.dewPoint ?? min.temperature, min.pressure ?? 500)
      ? p
      : min,
  );
  const dewPoint = source.dewPoint ?? source.temperature;
  let parcel = wetBulbStull(source.temperature, relativeHumidityFrom(source.temperature, dewPoint));
  let pressure = source.pressure ?? 500;
  const step = 25;
  let dcape = 0;
  for (let z = source.height; z > 0; z -= step) {
    const zNext = Math.max(0, z - step);
    const envHere = temperatureAt(column, z) ?? source.temperature;
    const envNext = temperatureAt(column, zNext) ?? envHere;
    // Discesa: la pressione aumenta (equazione ipsometrica), la particella satura si riscalda lungo la pseudo-adiabatica.
    const nextPressure = Math.min(pressure * Math.exp((G * (z - zNext)) / (RD * ((envHere + envNext) / 2 + KELVIN))), surfacePressure);
    parcel += moistAdiabaticLapseRate(parcel, pressure) * (z - zNext);
    pressure = nextPressure;
    const buoyancy = (G * (envNext - parcel)) / (envNext + KELVIN);
    if (buoyancy > 0) dcape += buoyancy * (z - zNext);
  }
  return { dcape, sourceHeight: source.height };
}

/**
 * Ciclo di vita sincronizzato con la cella: la corrente discendente nasce nella fase matura
 * (Byers & Braham) e l'impatto avviene al 2º passo maturo (al 1º se la fase matura dura un
 * solo passo), quando il nucleo di precipitazione collassa; è preceduto da DEVELOPING e
 * DESCENDING e seguito da OUTFLOW e DISSIPATING. Ogni stadio esiste solo mentre la cella esiste.
 */
export function downburstStages(outlook: ConvectiveOutlook, occurs: boolean): DownburstStage[] {
  const stages: DownburstStage[] = outlook.frames.map(() => 'NONE');
  if (!occurs) return stages;
  const matureIndexes = outlook.frames.flatMap((frame, index) => (frame.stage === 'MATURE' ? [index] : []));
  const impact = matureIndexes[1] ?? matureIndexes[0] ?? -1;
  if (impact < 0) return stages;
  const plan: [number, DownburstStage][] = [
    [impact - 2, 'DEVELOPING'],
    [impact - 1, 'DESCENDING'],
    [impact, 'IMPACT'],
    [impact + 1, 'OUTFLOW'],
    [impact + 2, 'DISSIPATING'],
  ];
  for (const [index, stage] of plan) {
    const cell = outlook.frames[index]?.stage;
    if (cell === undefined || cell === 'NONE' || cell === 'INITIATION') continue;
    stages[index] = stage;
  }
  return stages;
}

export function outflowSpeedClass(speed: number): OutflowSpeedClass {
  if (speed < DOWNBURST_REFERENCE.galeSpeed) return 'WEAK';
  if (speed < DOWNBURST_REFERENCE.severeSpeed) return 'MODERATE';
  return 'STRONG';
}

export class DownburstEngine {
  evaluate(outlook: ConvectiveOutlook, vertical: VerticalAnalysis, experimentColumn: ProfileColumn | null, surfacePressure: number | null): DownburstOutlook {
    const origin = { latitude: outlook.input.latitude, longitude: outlook.input.longitude };
    const empty = TIMELINE_MINUTES.map((minute) => ({ minute, stage: 'NONE' as DownburstStage, outflowRadius: 0, impactPoint: origin }));
    const nullFactors: Record<DownburstFactorKey, PhysicalFactor> = {
      dcape: { score: 0, value: null },
      loading: { score: 0, value: null },
      evaporation: { score: 0, value: null },
      lapseRate: { score: 0, value: null },
      cell: { score: 0, value: null },
    };
    if (!vertical.available || !experimentColumn) {
      return freeze({
        available: false,
        missing: vertical.available ? ['livelli sopra il suolo'] : vertical.missing,
        downburstPotential: 0,
        occurs: false,
        outflowSpeedClass: null,
        outflowRadius: 0,
        dcape: 0,
        factors: nullFactors,
        evaporationSource: null,
        limitingFactor: null,
        impactPoint: null,
        frames: empty,
      });
    }

    const { dcape } = downdraftCape(experimentColumn, surfacePressure ?? 1013.25);
    const subCloud =
      smoothstep(vertical.subCloudDryness, DOWNBURST_REFERENCE.subCloudMoist, DOWNBURST_REFERENCE.subCloudDry) *
      (0.5 + 0.5 * smoothstep(vertical.cloudBase, DOWNBURST_REFERENCE.baseLow, DOWNBURST_REFERENCE.baseHigh));
    const midLevel =
      vertical.midLevelDryness === null ? 0 : smoothstep(vertical.midLevelDryness, DOWNBURST_REFERENCE.midMoist, DOWNBURST_REFERENCE.midDry);
    const evaporation = Math.max(subCloud, midLevel);
    const mature = outlook.develops && reachesMaturity(outlook);

    const factors: Record<DownburstFactorKey, PhysicalFactor> = {
      dcape: { score: smoothstep(dcape, DOWNBURST_REFERENCE.dcapeLow, DOWNBURST_REFERENCE.dcapeHigh), value: dcape },
      loading: {
        score: smoothstep(outlook.peakReflectivity, DOWNBURST_REFERENCE.loadingLow, DOWNBURST_REFERENCE.loadingHigh),
        value: outlook.peakReflectivity,
      },
      evaporation: { score: evaporation, value: subCloud >= midLevel ? vertical.subCloudDryness : vertical.midLevelDryness },
      lapseRate: {
        score: vertical.lapseRateLow === null ? 0 : smoothstep(vertical.lapseRateLow, DOWNBURST_REFERENCE.lapseLow, DOWNBURST_REFERENCE.lapseSteep),
        value: vertical.lapseRateLow,
      },
      cell: { score: mature ? 1 : 0, value: outlook.peakReflectivity },
    };

    const potential = mature
      ? factors.loading.score * factors.dcape.score * (0.5 + 0.5 * factors.evaporation.score) * (0.6 + 0.4 * factors.lapseRate.score)
      : 0;
    const occurs = potential >= 0.5;

    const downdraft = 0.5 * Math.sqrt(2 * dcape) * (0.5 + 0.5 * factors.loading.score);
    const speed = downdraft + (0.5 * outlook.cellSpeed) / 3.6;
    const stages = downburstStages(outlook, occurs);
    const impactIndex = stages.indexOf('IMPACT');
    const impactFrame = outlook.frames[impactIndex];
    const impactPoint = impactFrame ? coreCenter(outlook, impactFrame) : null;
    const growth = (DOWNBURST_REFERENCE.gustFrontFactor * speed * 15 * 60) / 1000; // km per passo di 15 min

    let radius = 0;
    const frames = outlook.frames.map((frame, index): DownburstFrame => {
      const stage = stages[index] ?? 'NONE';
      if (stage === 'IMPACT') radius = DOWNBURST_REFERENCE.impactRadius;
      else if (stage === 'OUTFLOW') radius += growth;
      else if (stage === 'DISSIPATING') radius += growth * 0.5;
      else radius = 0;
      return Object.freeze({ minute: frame.minute, stage, outflowRadius: round(clamp(radius, 0, 40), 2), impactPoint: impactPoint ?? origin });
    });

    return freeze({
      available: true,
      missing: [],
      downburstPotential: round(potential, 3),
      occurs,
      outflowSpeedClass: occurs ? outflowSpeedClass(speed) : null,
      outflowRadius: Math.max(...frames.map((frame) => frame.outflowRadius)),
      dcape: round(dcape, 0),
      factors,
      evaporationSource:
        subCloud >= 0.5 && midLevel >= 0.5 ? 'both' : evaporation <= 0 ? null : subCloud >= midLevel ? 'sub-cloud' : 'mid-level',
      limitingFactor: occurs || !outlook.develops ? null : limitingOf(factors),
      impactPoint: occurs ? impactPoint : null,
      frames,
    });
  }
}

function limitingOf(factors: Record<DownburstFactorKey, PhysicalFactor>): DownburstFactorKey {
  if (factors.cell.score === 0) return 'cell';
  const effective: [DownburstFactorKey, number][] = [
    ['loading', factors.loading.score],
    ['dcape', factors.dcape.score],
    ['evaporation', 0.5 + 0.5 * factors.evaporation.score],
    ['lapseRate', 0.6 + 0.4 * factors.lapseRate.score],
  ];
  return effective.reduce((min, item) => (item[1] < min[1] ? item : min))[0];
}

function freeze(outlook: DownburstOutlook): DownburstOutlook {
  return Object.freeze({ ...outlook, frames: Object.freeze(outlook.frames.map((frame) => Object.freeze(frame))) });
}
