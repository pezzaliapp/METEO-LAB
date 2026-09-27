import type { DownburstFactorKey, DownburstOutlook, DownburstStage, OutflowSpeedClass } from '../engine/DownburstEngine';
import type { HailFactorKey, HailOutlook, HailSizeClass, HailStage } from '../engine/HailEngine';
import type { SevereOutlook } from '../engine/SevereWeather';
import type { ConvectiveOutlook } from '../engine/ConvectiveEngine';

/** Testi di GRANDINE LAB e DOWNBURST LAB. Le spiegazioni derivano dai valori calcolati. */

function n(value: number, decimals = 0): string {
  return value.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function km(metres: number | null): string {
  return metres === null ? '—' : `${n(metres / 1000, 1)} km`;
}

export const HAIL_STAGE_LABELS: Record<HailStage, string> = {
  NONE: '—',
  EMBRYO: 'Embrioni di ghiaccio',
  GROWING: 'Crescita dei chicchi',
  MATURE: 'Chicchi maturi',
  FALLING: 'Caduta al suolo',
  ENDED: 'Terminata',
};

export const DOWNBURST_STAGE_LABELS: Record<DownburstStage, string> = {
  NONE: '—',
  DEVELOPING: 'Formazione',
  DESCENDING: 'Discesa',
  IMPACT: 'Impatto al suolo',
  OUTFLOW: 'Espansione al suolo',
  DISSIPATING: 'Dissipazione',
};

export const HAIL_SIZE_LABELS: Record<HailSizeClass, string> = {
  NONE: '—',
  SMALL: 'piccola',
  MEDIUM: 'media',
  LARGE: 'grande',
};

export const OUTFLOW_LABELS: Record<OutflowSpeedClass, string> = {
  WEAK: 'debole',
  MODERATE: 'moderato',
  STRONG: 'forte',
};

const HAIL_SENTENCES: Partial<Record<HailStage, string>> = {
  EMBRYO: 'L’updraft porta goccioline e ghiaccio sopra lo zero termico: nascono gli embrioni di grandine.',
  GROWING: 'I chicchi crescono raccogliendo acqua sopraffusa nella zona fra −10 °C e −30 °C.',
  MATURE: 'I chicchi hanno raggiunto la dimensione massima del modello.',
  FALLING: 'L’updraft non riesce più a sostenerli: la grandine cade al suolo.',
};

const DOWNBURST_SENTENCES: Partial<Record<DownburstStage, string>> = {
  DEVELOPING: 'Nella nube si accumula un nucleo di precipitazione pesante.',
  DESCENDING: 'Evaporazione e peso della pioggia raffreddano l’aria: la corrente discendente accelera.',
  IMPACT: 'La corrente discendente colpisce il suolo.',
  OUTFLOW: 'L’aria fredda si espande al suolo: avanza un fronte di raffica.',
  DISSIPATING: 'Il fronte di raffica rallenta e si indebolisce.',
};

export function hailSentence(stage: HailStage): string | null {
  return HAIL_SENTENCES[stage] ?? null;
}

export function downburstSentence(stage: DownburstStage): string | null {
  return DOWNBURST_SENTENCES[stage] ?? null;
}

export type SevereResult = 'NONE' | 'HAIL' | 'DOWNBURST' | 'BOTH';

export function severeResult(severe: SevereOutlook): SevereResult {
  if (severe.hail.occurs && severe.downburst.occurs) return 'BOTH';
  if (severe.hail.occurs) return 'HAIL';
  if (severe.downburst.occurs) return 'DOWNBURST';
  return 'NONE';
}

export const SEVERE_TITLES: Record<SevereResult, string> = {
  NONE: 'TEMPORALE SENZA FENOMENI SEVERI',
  HAIL: 'GRANDINE',
  DOWNBURST: 'DOWNBURST',
  BOTH: 'GRANDINE + DOWNBURST',
};

/** PERCHÉ È SUCCESSO / PERCHÉ NON È SUCCESSO — grandine. */
export function hailExplanation(hail: HailOutlook, convection: ConvectiveOutlook): string {
  if (!hail.available) return 'Dati verticali insufficienti: il modello non valuta la grandine.';
  const f = hail.factors;
  const w = f.updraft.value ?? 0;
  const wbz = f.melting.value;
  if (!convection.develops) return 'Senza una cella temporalesca non può formarsi grandine.';
  if (hail.occurs) {
    const parts = [
      `L’updraft era intenso (circa ${n(w)} m/s nel modello) e lo zero del bulbo umido sufficientemente basso (circa ${km(wbz)}) da permettere al ghiaccio di crescere prima della caduta.`,
    ];
    if (f.lapseRate.score >= 0.5 && f.lapseRate.value !== null) {
      parts.push(`L’aria fredda in quota (gradiente 700–500 hPa di ${n(f.lapseRate.value, 1)} °C/km) ha rafforzato la crescita.`);
    }
    if (f.shear.score >= 0.5 && f.shear.value !== null) {
      parts.push(`Il vento che cambia con la quota (shear 0–6 km di ${n(f.shear.value)} m/s) ha organizzato la cella e prolungato la crescita.`);
    }
    return parts.join(' ');
  }
  const reasons: Record<HailFactorKey, string> = {
    updraft: `La corrente ascendente (circa ${n(w)} m/s nel modello) non era abbastanza forte da tenere sospesi i chicchi abbastanza a lungo.`,
    growthZone: 'La nube non raggiungeva in profondità la zona fra −10 °C e −30 °C, dove il ghiaccio cresce.',
    melting: `L’atmosfera era instabile, ma il livello di congelamento era troppo alto (zero del bulbo umido a circa ${km(wbz)}) per favorire grandine significativa nel modello: i chicchi fonderebbero cadendo.`,
    lapseRate: `L’aria in quota non era abbastanza fredda (gradiente 700–500 hPa di ${f.lapseRate.value === null ? '—' : n(f.lapseRate.value, 1)} °C/km): poca energia dove il ghiaccio dovrebbe crescere.`,
    shear:
      convection.organization === 'sheared'
        ? 'Il vento era troppo forte rispetto all’energia disponibile: la corrente ascendente è stata dispersa prima di maturare.'
        : `Il vento cambiava poco con la quota (shear 0–6 km di ${f.shear.value === null ? '—' : n(f.shear.value)} m/s): la cella non si organizza e l’updraft dura poco.`,
  };
  return hail.limitingFactor ? reasons[hail.limitingFactor] : 'Le condizioni non erano sufficienti per la grandine nel modello.';
}

/** PERCHÉ È SUCCESSO / PERCHÉ NON È SUCCESSO — downburst. */
export function downburstExplanation(downburst: DownburstOutlook, convection: ConvectiveOutlook, cloudBase: number | null): string {
  if (!downburst.available) return 'Dati verticali insufficienti: il modello non valuta il downburst.';
  if (!convection.develops) return 'Senza una cella temporalesca non può formarsi un downburst.';
  const f = downburst.factors;
  if (downburst.occurs) {
    const parts: string[] = [];
    if (downburst.evaporationSource === 'sub-cloud' || downburst.evaporationSource === 'both') {
      parts.push(
        `L’aria più secca sotto la nube (base a circa ${cloudBase === null ? '—' : n(Math.round(cloudBase / 50) * 50)} m) ha favorito evaporazione e raffreddamento, rafforzando la corrente discendente.`,
      );
    }
    if (downburst.evaporationSource === 'mid-level') {
      parts.push('L’aria secca fra 3 e 6 km, trascinata nella nube, ha favorito evaporazione e raffreddamento, rafforzando la corrente discendente.');
    } else if (downburst.evaporationSource === 'both') {
      parts.push('Anche l’aria secca fra 3 e 6 km, trascinata nella nube, ha aumentato l’evaporazione.');
    }
    parts.push(`La precipitazione intensa (${n(f.loading.value ?? 0)} dBZ nel radar simulato) ha appesantito l’aria che scendeva.`);
    parts.push(`Nel modello l’aria raffreddata aveva un’energia di discesa di circa ${n(downburst.dcape, 0)} J/kg (DCAPE didattica).`);
    return parts.join(' ');
  }
  const reasons: Record<DownburstFactorKey, string> = {
    cell: 'La cella non ha raggiunto la fase matura: manca il nucleo di precipitazione che innesca la corrente discendente.',
    loading: 'La precipitazione non era abbastanza intensa da trascinare e raffreddare l’aria verso il basso.',
    dcape: `L’aria raffreddata dall’evaporazione non diventava abbastanza più fredda dell’ambiente (DCAPE didattica di circa ${n(downburst.dcape, 0)} J/kg).`,
    evaporation: 'L’aria sotto la nube e in quota era umida: poca evaporazione, poco raffreddamento, corrente discendente debole.',
    lapseRate: 'Lo strato vicino al suolo era stabile: l’aria che scende si riscalda presto e rallenta.',
  };
  return downburst.limitingFactor ? reasons[downburst.limitingFactor] : 'Le condizioni non erano sufficienti per un downburst nel modello.';
}

/** Indice didattico 0…1 con due decimali (mai presentato come percentuale). */
export function formatIndex(value: number): string {
  return n(value, 2);
}
