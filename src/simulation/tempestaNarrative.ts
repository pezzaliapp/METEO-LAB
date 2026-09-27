import {
  bearingBetween,
  distanceKm,
  type ConvectiveOutlook,
  type LifecycleStage,
  type LimitingFactor,
} from '../engine/ConvectiveEngine';
import { bandOf } from '../engine/SimulatedRadar';
import type { SimulationParameters } from '../models/SimulationState';

function number(value: number, decimals: number): string {
  return value.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Testi di TEMPESTA LAB: una frase semplice per fase, nessun linguaggio allarmistico. */

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  NONE: 'Nessuna cella',
  INITIATION: 'Innesco',
  DEVELOPING: 'Sviluppo',
  MATURE: 'Maturità',
  WEAKENING: 'Indebolimento',
  DISSIPATING: 'Dissipazione',
};

export interface ParameterChanges {
  readonly temperature: number;
  readonly relativeHumidity: number;
  readonly windSpeed: number;
}

export function phaseSentence(outlook: ConvectiveOutlook, minute: number, changes: ParameterChanges): string {
  const index = outlook.frames.findIndex((frame) => frame.minute === minute);
  const frame = outlook.frames[index];
  if (!frame) return '';
  const previous = outlook.frames.slice(0, index);
  const hadCell = previous.some((item) => item.stage !== 'NONE');
  switch (frame.stage) {
    case 'NONE':
      return hadCell
        ? 'La cella si è esaurita: il radar simulato torna pulito.'
        : 'L’aria vicino al suolo inizia a salire: ancora nessun eco radar.';
    case 'INITIATION':
      return changes.temperature > 0 || changes.relativeHumidity > 0
        ? 'L’aumento di temperatura e umidità favorisce la convezione.'
        : 'L’aria calda e umida sale e condensa: compaiono i primi echi.';
    case 'DEVELOPING':
      return outlook.organization === 'sheared'
        ? 'La cella cresce, ma il vento forte la inclina.'
        : 'La cella sta crescendo.';
    case 'MATURE': {
      const matureBefore = previous.filter((item) => item.stage === 'MATURE').length;
      if (matureBefore === 0) return 'La cella raggiunge la fase più intensa.';
      return outlook.organization === 'single'
        ? 'La cella resta matura: pioggia più forte sotto il nucleo.'
        : 'Nuove celle nascono sul fianco: il sistema si rinnova.';
    }
    case 'WEAKENING':
      return outlook.organization === 'sheared'
        ? 'Il vento disperde la corrente ascendente: la cella perde forza.'
        : 'L’alimentazione della cella diminuisce.';
    case 'DISSIPATING':
      return 'La cella si dissolve: resta una pioggia debole.';
  }
}

export const LIMITING_EXPLANATIONS: Record<LimitingFactor, string> = {
  dry: 'Aria troppo secca: la condensazione inizierebbe molto in alto e le correnti ascendenti non trovano abbastanza vapore.',
  stable:
    'L’aria sollevata diventa più fredda dell’aria circostante: l’atmosfera è stabile e frena i moti verticali.',
  inhibition:
    'Uno strato stabile vicino al suolo blocca le correnti ascendenti prima che possano salire liberamente.',
};

export function outcomeTitle(outlook: ConvectiveOutlook): string {
  if (!outlook.develops) return 'NESSUNA CONVEZIONE SIGNIFICATIVA';
  return outlook.peakReflectivity < 45 ? 'SVILUPPO DEBOLE' : 'CONVEZIONE IN SVILUPPO';
}

const COMPASS_TO = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];

export function compassTo(degrees: number): string {
  return COMPASS_TO[Math.round((((degrees % 360) + 360) % 360) / 45) % 8] ?? 'nord';
}

export interface ExperimentSummary {
  /** Minuti con eco radar visibile (a passi di 15). */
  readonly durationMinutes: number;
  /** true se a T+90 la cella è ancora presente. */
  readonly stillActive: boolean;
  readonly peakReflectivity: number;
  readonly peakBandLabel: string;
  readonly peakRainRate: number;
  readonly displacementKm: number;
  readonly displacementDirection: string;
  readonly explanation: string;
}

export function summarize(outlook: ConvectiveOutlook, parameters: SimulationParameters, changes: ParameterChanges): ExperimentSummary {
  const active = outlook.frames.filter((frame) => frame.stage !== 'NONE');
  const first = active[0];
  const last = active.at(-1);
  const final = outlook.frames.at(-1);
  const displacement = first && last ? distanceKm(first.center, last.center) : 0;
  const direction = first && last && displacement > 0.1 ? compassTo(bearingBetween(first.center, last.center)) : '—';
  const d = outlook.diagnostics;

  const causes: string[] = [];
  const cloudBase = d.lclHeight === null ? null : Math.round(d.lclHeight / 50) * 50;
  if (cloudBase !== null) {
    causes.push(
      `Con ${number(parameters.temperature, 1)} °C e ${number(parameters.relativeHumidity, 0)} % di umidità la base delle nubi si forma a circa ${number(cloudBase, 0)} m.`,
    );
  }
  if (outlook.develops) {
    const top = d.equilibriumHeight === null ? null : number(d.equilibriumHeight / 1000, 1);
    causes.push(
      top
        ? `L’aria sollevata resta più calda dell’ambiente fino a circa ${top} km: è questa energia a far crescere la cella.`
        : 'L’aria sollevata resta più calda dell’ambiente e la cella cresce.',
    );
    if (changes.temperature > 0 || changes.relativeHumidity > 0) {
      causes.push('Più calore e più vapore vicino al suolo rendono l’aria più leggera di quella in quota.');
    }
    causes.push(
      outlook.cellSpeed < 1
        ? 'Senza vento la cella resta quasi ferma.'
        : outlook.diagnostics.environmentSource === 'profile'
          ? `Il vento medio fra il suolo e 6 km (${number(outlook.cellSpeed, 0)} km/h, dal profilo atmosferico) la trasporta verso ${compassTo(outlook.cellDirection)}${organizationNote(outlook)}.`
          : `Il vento di ${number(parameters.windSpeed, 0)} km/h la trasporta verso ${compassTo(outlook.cellDirection)}${organizationNote(outlook)}.`,
    );
  } else if (outlook.limitingFactor) {
    causes.push(LIMITING_EXPLANATIONS[outlook.limitingFactor]);
  }

  return {
    durationMinutes: active.length === 0 ? 0 : active.length * 15,
    stillActive: final ? final.stage !== 'NONE' : false,
    peakReflectivity: outlook.peakReflectivity,
    peakBandLabel: bandOf(outlook.peakReflectivity)?.label ?? '—',
    peakRainRate: outlook.precipitationIntensity,
    displacementKm: displacement,
    displacementDirection: direction,
    explanation: causes.join(' '),
  };
}

function organizationNote(outlook: ConvectiveOutlook): string {
  switch (outlook.organization) {
    case 'multicell':
      return '; il vento più forte in quota organizza nuove celle e allunga la vita del sistema';
    case 'organized':
      return '; il forte vento in quota separa corrente ascendente e discendente e la cella dura più a lungo';
    case 'sheared':
      return ', ma è troppo forte rispetto all’energia disponibile e disperde la corrente ascendente';
    default:
      return '';
  }
}
