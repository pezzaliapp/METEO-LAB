import { TIMELINE_MINUTES } from '../simulation/timeline';
import type { ConvectiveOutlook, GeoPoint } from './ConvectiveEngine';
import { clamp, round, smoothstep } from './physics';
import { coreCenter, reachesMaturity, type PhysicalFactor } from './SevereCommon';
import type { VerticalAnalysis } from './VerticalProfileEngine';

/**
 * HailEngine — GRANDINE LAB. Modello DIDATTICO, non operativo: nessuna previsione.
 *
 * La grandine richiede (e qui dipende da) cinque condizioni fisiche, tutte calcolate
 * dal PROFILO ATMOSFERICO e dalla cella del ConvectiveEngine:
 *
 *  1. UPDRAFT capace di sostenere i chicchi. La velocità terminale di un chicco cresce
 *     circa con √D. Valori indicativi NOAA/NSSL: ~18 m/s di updraft per 2,5 cm,
 *     ~25 m/s per 4,4 cm, ~46 m/s per 10 cm; qui v ≈ 12·√D m/s (D in cm):
 *     1 cm → 12 m/s, 4 cm → 24 m/s. Fattore = smoothstep(w, 12, 24).
 *  2. ZONA DI CRESCITA: il ghiaccio cresce soprattutto fra −10 °C e −30 °C (acqua
 *     sopraffusa). Fattore = frazione dello strato −10…−30 °C attraversata dall'updraft
 *     (fino al livello di equilibrio).
 *  3. FUSIONE: sotto lo zero del bulbo umido i chicchi fondono. Con zero del bulbo umido
 *     oltre ~3,4 km (11 000 ft, soglia usata nella pratica operativa per la grandine grande)
 *     la fusione aumenta. Fattore = 1 − smoothstep(WBZ, 3400, 4600) m.
 *  4. GRADIENTE 700–500 hPa: aria fredda in quota e gradienti ripidi (> 7 °C/km) aumentano
 *     il galleggiamento nella zona di crescita. Fattore = smoothstep(Γ, 5,5, 7,5).
 *  5. SHEAR 0–6 km: celle organizzate (> 20 m/s) mantengono l'updraft più a lungo e
 *     prolungano il tempo di crescita. Fattore = smoothstep(shear, 10, 25).
 *
 *  hailPotential = updraft × zona × fusione × (0,5 + 0,5·gradiente) × (0,6 + 0,4·shear)
 *  (i primi tre sono indispensabili; gradiente e shear rafforzano o indeboliscono).
 *  È un INDICE DIDATTICO 0…1, non una probabilità calibrata.
 *
 *  Classe di dimensione: diametro sostenibile dall'updraft D = (w/12)², ridotto da fusione,
 *  shear e gradiente; classi a 2,5 cm (soglia "severe" NWS) e 5 cm (grandine "significativa"
 *  SPC). Solo le classi SMALL/MEDIUM/LARGE sono mostrate: non sono misure previste.
 */

export type HailStage = 'NONE' | 'EMBRYO' | 'GROWING' | 'MATURE' | 'FALLING' | 'ENDED';
export type HailSizeClass = 'NONE' | 'SMALL' | 'MEDIUM' | 'LARGE';
export type HailFactorKey = 'updraft' | 'growthZone' | 'melting' | 'lapseRate' | 'shear';

export interface HailFrame {
  readonly minute: number;
  readonly stage: HailStage;
  /** km — raggio del nucleo grandinigeno sulla mappa (0 = non visibile). */
  readonly coreRadius: number;
  readonly center: GeoPoint;
}

export interface HailOutlook {
  readonly available: boolean;
  /** Dati verticali mancanti (se available = false). */
  readonly missing: readonly string[];
  readonly hailPotential: number;
  readonly occurs: boolean;
  readonly hailSizeClass: HailSizeClass;
  /** km — raggio massimo del nucleo. */
  readonly hailCoreRadius: number;
  readonly factors: Readonly<Record<HailFactorKey, PhysicalFactor>>;
  /** Fattore più sfavorevole (spiega perché NON è successo). */
  readonly limitingFactor: HailFactorKey | null;
  readonly frames: readonly HailFrame[];
}

export const HAIL_REFERENCE = {
  terminalVelocityCoefficient: 12,
  updraftSmall: 12,
  updraftLarge: 24,
  wbzFavorableMax: 3400,
  wbzUnfavorable: 4600,
  lapseMin: 5.5,
  lapseSteep: 7.5,
  shearWeak: 10,
  shearStrong: 25,
  severeSize: 2.5,
  significantSize: 5,
} as const;

const CORE_SHARE: Record<HailStage, number> = { NONE: 0, EMBRYO: 0, GROWING: 0.6, MATURE: 1, FALLING: 0.8, ENDED: 0 };

export function hailFactors(outlook: ConvectiveOutlook, vertical: VerticalAnalysis): Record<HailFactorKey, PhysicalFactor> | null {
  if (!vertical.available) return null;
  const w = outlook.diagnostics.updraft;
  const top = outlook.diagnostics.equilibriumHeight;
  const { isotherm10, isotherm30 } = vertical;
  let growth = 0;
  if (top !== null && isotherm10 !== null) {
    const upper = isotherm30 ?? isotherm10 + 3000;
    growth = clamp((Math.min(top, upper) - isotherm10) / (upper - isotherm10), 0, 1);
  }
  const wbz = vertical.wetBulbZeroApprox ?? vertical.freezingLevel;
  return {
    updraft: { score: smoothstep(w, HAIL_REFERENCE.updraftSmall, HAIL_REFERENCE.updraftLarge), value: w },
    growthZone: { score: growth, value: top },
    melting: { score: wbz === null ? 0 : 1 - smoothstep(wbz, HAIL_REFERENCE.wbzFavorableMax, HAIL_REFERENCE.wbzUnfavorable), value: wbz },
    lapseRate: {
      score: vertical.lapseRateMid === null ? 0 : smoothstep(vertical.lapseRateMid, HAIL_REFERENCE.lapseMin, HAIL_REFERENCE.lapseSteep),
      value: vertical.lapseRateMid,
    },
    shear: {
      score: vertical.deepLayerShear === null ? 0 : smoothstep(vertical.deepLayerShear, HAIL_REFERENCE.shearWeak, HAIL_REFERENCE.shearStrong),
      value: vertical.deepLayerShear,
    },
  };
}

function sizeClassOf(diameter: number): HailSizeClass {
  if (diameter <= 0) return 'NONE';
  if (diameter < HAIL_REFERENCE.severeSize) return 'SMALL';
  if (diameter < HAIL_REFERENCE.significantSize) return 'MEDIUM';
  return 'LARGE';
}

/**
 * Ciclo di vita sincronizzato con la cella:
 * DEVELOPING → EMBRYO (embrioni portati sopra lo zero termico), 1ª MATURE → GROWING,
 * 2ª MATURE → MATURE (chicchi alla dimensione massima), MATURE successive e WEAKENING →
 * FALLING (i chicchi raggiungono il suolo; con l'indebolimento l'updraft non li sostiene più),
 * DISSIPATING e oltre → ENDED. Mai a T+0, mai dopo la fine della cella.
 */
export function hailStages(outlook: ConvectiveOutlook, occurs: boolean): HailStage[] {
  let matureCount = 0;
  let started = false;
  return outlook.frames.map((frame): HailStage => {
    if (!occurs) return 'NONE';
    switch (frame.stage) {
      case 'DEVELOPING':
        started = true;
        return 'EMBRYO';
      case 'MATURE':
        started = true;
        matureCount++;
        return matureCount === 1 ? 'GROWING' : matureCount === 2 ? 'MATURE' : 'FALLING';
      case 'WEAKENING':
        return started ? 'FALLING' : 'NONE';
      case 'DISSIPATING':
        return started ? 'ENDED' : 'NONE';
      case 'NONE':
        return started ? 'ENDED' : 'NONE';
      default:
        return 'NONE';
    }
  });
}

export class HailEngine {
  evaluate(outlook: ConvectiveOutlook, vertical: VerticalAnalysis): HailOutlook {
    const factors = hailFactors(outlook, vertical);
    const empty = TIMELINE_MINUTES.map((minute, index) => ({
      minute,
      stage: 'NONE' as HailStage,
      coreRadius: 0,
      center: outlook.frames[index]?.center ?? { latitude: outlook.input.latitude, longitude: outlook.input.longitude },
    }));
    if (!factors) {
      return freeze({
        available: false,
        missing: vertical.available ? [] : vertical.missing,
        hailPotential: 0,
        occurs: false,
        hailSizeClass: 'NONE',
        hailCoreRadius: 0,
        factors: {
          updraft: { score: 0, value: null },
          growthZone: { score: 0, value: null },
          melting: { score: 0, value: null },
          lapseRate: { score: 0, value: null },
          shear: { score: 0, value: null },
        },
        limitingFactor: null,
        frames: empty,
      });
    }

    const f = factors;
    const potential = outlook.develops
      ? f.updraft.score * f.growthZone.score * f.melting.score * (0.5 + 0.5 * f.lapseRate.score) * (0.6 + 0.4 * f.shear.score)
      : 0;
    const canGrow = outlook.develops && outlook.organization !== 'sheared' && reachesMaturity(outlook);
    const occurs = canGrow && potential >= 0.5;

    const w = outlook.diagnostics.updraft;
    const diameter = occurs
      ? (w / HAIL_REFERENCE.terminalVelocityCoefficient) ** 2 * f.melting.score * (0.6 + 0.4 * f.shear.score) * (0.5 + 0.5 * f.lapseRate.score)
      : 0;
    const hailCoreRadius = occurs ? outlook.cellRadius * 0.35 * (0.6 + 0.4 * potential) : 0;

    const stages = hailStages(outlook, occurs);
    const frames = outlook.frames.map((frame, index): HailFrame => {
      const stage = stages[index] ?? 'NONE';
      return Object.freeze({
        minute: frame.minute,
        stage,
        coreRadius: round(hailCoreRadius * CORE_SHARE[stage], 2),
        center: coreCenter(outlook, frame),
      });
    });

    return freeze({
      available: true,
      missing: [],
      hailPotential: round(potential, 3),
      occurs,
      hailSizeClass: sizeClassOf(diameter),
      hailCoreRadius: round(hailCoreRadius, 2),
      factors: f,
      limitingFactor: occurs ? null : limitingOf(f, outlook),
      frames,
    });
  }
}

function limitingOf(factors: Record<HailFactorKey, PhysicalFactor>, outlook: ConvectiveOutlook): HailFactorKey | null {
  if (!outlook.develops) return null;
  // I fattori indispensabili pesano per intero; gradiente e shear solo per la parte che modulano.
  const effective: [HailFactorKey, number][] = [
    ['updraft', factors.updraft.score],
    ['growthZone', factors.growthZone.score],
    ['melting', factors.melting.score],
    ['lapseRate', 0.5 + 0.5 * factors.lapseRate.score],
    ['shear', 0.6 + 0.4 * factors.shear.score],
  ];
  if (outlook.organization === 'sheared') return 'shear';
  return effective.reduce((min, item) => (item[1] < min[1] ? item : min))[0];
}

function freeze(outlook: HailOutlook): HailOutlook {
  return Object.freeze({ ...outlook, frames: Object.freeze(outlook.frames.map((frame) => Object.freeze(frame))) });
}
