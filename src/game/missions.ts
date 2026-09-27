import { downburstExplanation, hailExplanation } from '../simulation/severeNarrative';
import { summarize } from '../simulation/tempestaNarrative';
import type {
  HintRule,
  Hypothesis,
  MissionContext,
  MissionDefinition,
  MissionEvaluation,
  MissionId,
  Outcome,
} from './MissionEngine';

/**
 * Le otto MISSIONI. Condizioni di successo, analisi e indizi interrogano SOLO i risultati dei
 * motori (MissionEvaluation); nessuna soglia meteorologica è ridefinita qui.
 */

function n(value: number, decimals = 0): string {
  return value.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  NONE: '○ NESSUNA CONVEZIONE',
  FAVORABLE: '◇ ATMOSFERA FAVOREVOLE, NESSUNA CELLA',
  STORM: '▲ TEMPORALE',
  HAIL: '▲ TEMPORALE + ● GRANDINE',
  DOWNBURST: '▲ TEMPORALE + ↓ DOWNBURST',
  BOTH: '▲ TEMPORALE + ● GRANDINE + ↓ DOWNBURST',
};

export const HYPOTHESIS_LABELS: Record<Hypothesis, string> = {
  NONE: 'NESSUNA CONVEZIONE',
  FAVORABLE: 'ATMOSFERA FAVOREVOLE',
  STORM: 'TEMPORALE',
  HAIL: 'GRANDINE',
  DOWNBURST: 'DOWNBURST',
};

/* ------------------------------------------------------------------------ */
/* Frasi derivate dai risultati dei motori                                   */
/* ------------------------------------------------------------------------ */

function convectionReason(e: MissionEvaluation): string {
  return summarize(e.convection, e.parameters, { temperature: 0, relativeHumidity: 0, windSpeed: 0 }).explanation;
}

function surfaceChange(e: MissionEvaluation, c: MissionContext): string {
  const warmer = e.parameters.temperature > c.baseline.parameters.temperature + 0.05;
  const cooler = e.parameters.temperature < c.baseline.parameters.temperature - 0.05;
  const moister = e.parameters.relativeHumidity > c.baseline.parameters.relativeHumidity;
  const drier = e.parameters.relativeHumidity < c.baseline.parameters.relativeHumidity;
  const parts = [warmer ? 'più calda' : cooler ? 'più fresca' : null, moister ? 'più umida' : drier ? 'più secca' : null].filter(Boolean);
  return parts.length === 0 ? 'La superficie, con il vento modificato,' : `La superficie ${parts.join(' e ')}`;
}

function cape(e: MissionEvaluation): string {
  return `${n(e.convection.diagnostics.capeProxy)} J/kg`;
}

function updraft(e: MissionEvaluation): string {
  return `circa ${n(e.convection.diagnostics.updraft)} m/s nel modello`;
}

function wbz(e: MissionEvaluation): string {
  const v = e.severe.vertical.available ? (e.severe.vertical.wetBulbZeroApprox ?? e.severe.vertical.freezingLevel) : null;
  return v === null ? '—' : `${n(v / 1000, 1)} km`;
}

function noConvectionHints(): HintRule[] {
  return [
    {
      when: (e) => !e.convection.develops && e.convection.limitingFactor === 'dry',
      text: 'Osserva quanto è umida l’aria vicino al suolo.',
    },
    {
      when: (e) => !e.convection.develops && e.convection.limitingFactor === 'stable',
      text: 'Confronta l’aria al suolo con l’aria in quota: che cosa rende più leggera l’aria che sale?',
    },
    {
      when: (e) => !e.convection.develops && e.convection.limitingFactor === 'inhibition',
      text: 'Uno strato stabile vicino al suolo frena l’aria che sale: serve più spinta dal basso.',
    },
  ];
}

const HAIL_HINTS: HintRule[] = [
  { when: (e) => e.convection.develops && e.severe.hail.limitingFactor === 'updraft', text: 'Una corrente ascendente più intensa potrebbe cambiare il risultato.' },
  { when: (e) => e.severe.hail.limitingFactor === 'melting', text: 'Guarda dove si trova lo zero termico nel PROFILO.' },
  { when: (e) => e.severe.hail.limitingFactor === 'growthZone', text: 'La nube arriva abbastanza in alto, fino all’aria molto fredda?' },
  { when: (e) => e.severe.hail.limitingFactor === 'lapseRate', text: 'Guarda nel PROFILO quanto è fredda l’aria in quota.' },
  { when: (e) => e.severe.hail.limitingFactor === 'shear', text: 'Osserva come cambia il vento con la quota.' },
];

const DOWNBURST_HINTS: HintRule[] = [
  { when: (e) => e.severe.downburst.limitingFactor === 'cell', text: 'Il downburst nasce da una cella matura: prima serve una cella più robusta.' },
  { when: (e) => e.severe.downburst.limitingFactor === 'loading', text: 'Serve un nucleo di precipitazione più intenso.' },
  { when: (e) => e.severe.downburst.limitingFactor === 'evaporation', text: 'L’aria sotto la nube è molto umida: poca evaporazione.' },
  { when: (e) => e.severe.downburst.limitingFactor === 'dcape', text: 'L’aria che scende deve diventare più fredda dell’aria intorno.' },
  { when: (e) => e.severe.downburst.limitingFactor === 'lapseRate', text: 'Guarda come cambia la temperatura nei primi chilometri sopra il suolo.' },
];

/* ------------------------------------------------------------------------ */
/* Missioni                                                                  */
/* ------------------------------------------------------------------------ */

const ALL = ['temperature', 'relativeHumidity', 'windSpeed'] as const;
const BASIC_HYPOTHESES: readonly Hypothesis[] = ['NONE', 'STORM'];
const FULL_HYPOTHESES: readonly Hypothesis[] = ['NONE', 'STORM', 'HAIL', 'DOWNBURST'];

export const MISSIONS: readonly MissionDefinition[] = [
  {
    id: '01',
    title: 'ACCENDI L’ATMOSFERA',
    objective: 'Rendi l’atmosfera favorevole alla convezione. Non serve una tempesta.',
    description: 'L’aria è stabile. Scopri come temperatura e umidità vicino al suolo cambiano l’energia dell’aria che sale.',
    scenario: 'pianura',
    allowedControls: ['temperature', 'relativeHumidity'],
    hypotheses: ['NONE', 'FAVORABLE', 'STORM'],
    liveChallenge: true,
    successCondition: (e) => e.outcome !== 'NONE',
    failureAnalysis: (e) => [convectionReason(e)],
    successAnalysis: (e, c) => ({
      headline: 'HAI ACCESO L’ATMOSFERA.',
      reasons: [
        `${surfaceChange(e, c)} rende l’aria che sale più leggera dell’aria in quota: l’energia convettiva didattica passa da ${cape(c.baseline)} a ${cape(e)}.`,
        e.convection.develops ? 'Ed è bastato per far nascere una cella.' : 'Non è ancora una tempesta: l’energia c’è, la cella non ancora.',
      ],
    }),
    hintRules: [...noConvectionHints()],
  },
  {
    id: '02',
    title: 'COSTRUISCI UNA TEMPESTA',
    objective: 'Crea una cella temporalesca.',
    description: 'Trasforma l’aria calma della pianura in una cella che cresce, matura e si dissolve sulla mappa.',
    scenario: 'pianura',
    allowedControls: ALL,
    hypotheses: BASIC_HYPOTHESES,
    liveChallenge: true,
    successCondition: (e) => e.convection.develops,
    failureAnalysis: (e) => [convectionReason(e)],
    successAnalysis: (e, c) => ({
      headline: 'HAI COSTRUITO UNA TEMPESTA.',
      reasons: [
        `${surfaceChange(e, c)} ha abbassato la base delle nubi e reso l’aria sollevata più calda dell’ambiente (energia convettiva didattica ${cape(e)}).`,
        `La corrente ascendente (${updraft(e)}) ha formato la cella.`,
      ],
    }),
    hintRules: [...noConvectionHints()],
  },
  {
    id: '03',
    title: 'CREA GRANDINE',
    objective: 'Ottieni grandine simulata.',
    description:
      'Una corrente ascensionale intensa può mantenere le particelle di ghiaccio nella nube abbastanza a lungo da farle crescere.',
    scenario: 'pianura',
    allowedControls: ALL,
    hypotheses: ['NONE', 'STORM', 'HAIL'],
    liveChallenge: true,
    successCondition: (e) => e.severe.hail.available && e.hailReached,
    failureAnalysis: (e) => (e.convection.develops ? [hailExplanation(e.severe.hail, e.convection)] : [convectionReason(e)]),
    successAnalysis: (e, c) => ({
      headline: 'HAI CREATO GRANDINE.',
      reasons: [
        `Non perché hai «alzato un valore». ${surfaceChange(e, c)} ha rafforzato l’updraft (${updraft(e)}).`,
        `Il profilo in quota era già favorevole alla crescita del ghiaccio: zero del bulbo umido a ${wbz(e)}.`,
      ],
    }),
    hintRules: [...noConvectionHints(), ...HAIL_HINTS],
  },
  {
    id: '04',
    title: 'CREA UN DOWNBURST',
    objective: 'Ottieni un downburst simulato che raggiunge il suolo.',
    description: 'Precipitazioni intense e raffreddamento dell’aria possono accelerare una corrente discendente.',
    scenario: 'altopiano',
    allowedControls: ALL,
    hypotheses: ['NONE', 'STORM', 'DOWNBURST'],
    liveChallenge: true,
    successCondition: (e) => e.severe.downburst.available && e.impactReached,
    failureAnalysis: (e) => (e.convection.develops ? [downburstExplanation(e.severe.downburst, e.convection, e.severe.vertical.available ? e.severe.vertical.cloudBase : null)] : [convectionReason(e)]),
    successAnalysis: (e, c) => ({
      headline: 'HAI PRODOTTO UN DOWNBURST.',
      reasons: [
        `${surfaceChange(e, c)} ha reso la cella abbastanza intensa da caricare il nucleo di pioggia (${n(e.convection.peakReflectivity)} dBZ).`,
        `Sotto la nube l’aria è secca: l’evaporazione la raffredda e la corrente discendente accelera fino al suolo (DCAPE didattica ${n(e.severe.downburst.dcape)} J/kg).`,
      ],
    }),
    hintRules: [...noConvectionHints(), ...DOWNBURST_HINTS],
  },
  {
    id: '05',
    title: 'TEMPORALE, MA NON SEVERO',
    objective: 'Crea una cella temporalesca senza grandine e senza downburst.',
    description: 'Un temporale non è automaticamente un fenomeno severo. Trova il temporale «ordinario».',
    scenario: 'pianura',
    allowedControls: ALL,
    hypotheses: FULL_HYPOTHESES,
    liveChallenge: true,
    successCondition: (e) => e.convection.develops && e.severe.vertical.available && !e.hailReached && !e.impactReached,
    failureAnalysis: (e) => {
      if (!e.convection.develops) return [convectionReason(e)];
      const reasons: string[] = [];
      if (e.hailReached) reasons.push(`La cella ha prodotto grandine. ${hailExplanation(e.severe.hail, e.convection)}`);
      if (e.impactReached) {
        reasons.push(`La cella ha prodotto un downburst. ${downburstExplanation(e.severe.downburst, e.convection, e.severe.vertical.available ? e.severe.vertical.cloudBase : null)}`);
      }
      return reasons;
    },
    successAnalysis: (e) => ({
      headline: 'UN TEMPORALE, MA NON SEVERO.',
      reasons: [
        `La cella si è formata (${updraft(e)}), ma non abbastanza intensa per i fenomeni severi.`,
        hailExplanation(e.severe.hail, e.convection),
        downburstExplanation(e.severe.downburst, e.convection, e.severe.vertical.available ? e.severe.vertical.cloudBase : null),
      ],
    }),
    hintRules: [
      ...noConvectionHints(),
      { when: (e) => e.hailReached, text: 'Una cella meno esplosiva potrebbe restare un temporale ordinario.' },
      { when: (e) => e.impactReached, text: 'Guarda quanto è secca l’aria sotto la nube.' },
    ],
  },
  {
    id: '06',
    title: 'FERMA LA GRANDINE',
    objective: 'Mantieni la tempesta, ma senza grandine.',
    description: 'In questo scenario la cella produce grandine. Cambia l’atmosfera al suolo perché resti un temporale senza grandine.',
    scenario: 'pianura-grandine',
    allowedControls: ALL,
    hypotheses: FULL_HYPOTHESES,
    liveChallenge: false,
    successCondition: (e) => e.convection.develops && e.severe.hail.available && !e.hailReached,
    failureAnalysis: (e) =>
      e.convection.develops
        ? [`La grandine c’è ancora (updraft ${updraft(e)}, zero del bulbo umido a ${wbz(e)}).`]
        : ['La tempesta è scomparsa: la missione chiede di mantenerla.', convectionReason(e)],
    successAnalysis: (e, c) => ({
      headline: 'HAI FERMATO LA GRANDINE.',
      reasons: [`La tempesta è rimasta attiva, ma ${stoppedHail(e, c)}`],
    }),
    hintRules: [
      { when: (e) => !e.convection.develops, text: 'La cella è sparita: prova un intervento più piccolo.' },
      { when: (e) => e.hailReached, text: 'Che cosa rende così forte la corrente ascendente?' },
    ],
  },
  {
    id: '07',
    title: 'FERMA IL DOWNBURST',
    objective: 'Mantieni la tempesta, ma impedisci al downburst di raggiungere il suolo.',
    description: 'In questo scenario la cella produce un downburst. Cambia l’atmosfera al suolo perché la corrente discendente resti debole.',
    scenario: 'meseta-downburst',
    allowedControls: ALL,
    hypotheses: FULL_HYPOTHESES,
    liveChallenge: false,
    successCondition: (e) => e.convection.develops && e.severe.downburst.available && !e.impactReached,
    failureAnalysis: (e) =>
      e.convection.develops
        ? [`Il downburst raggiunge ancora il suolo (DCAPE didattica ${n(e.severe.downburst.dcape)} J/kg).`]
        : ['La tempesta è scomparsa: la missione chiede di mantenerla.', convectionReason(e)],
    successAnalysis: (e, c) => ({
      headline: 'HAI FERMATO IL DOWNBURST.',
      reasons: [`La tempesta è rimasta attiva, ma ${stoppedDownburst(e, c)}`],
    }),
    hintRules: [
      { when: (e) => !e.convection.develops, text: 'La cella è sparita: prova un intervento più piccolo.' },
      { when: (e) => e.impactReached, text: 'L’aria sotto la nube è molto secca.' },
    ],
  },
  {
    id: '08',
    title: 'IL MINIMO CAMBIAMENTO',
    objective: 'Ottieni una tempesta con un INTERVENTO MINIMO sull’atmosfera iniziale.',
    description: 'Non conta quanto cambi, ma che cosa cambi. Qual è la leva più efficace?',
    scenario: 'meseta',
    allowedControls: ALL,
    hypotheses: BASIC_HYPOTHESES,
    liveChallenge: true,
    successCondition: (e, c) => e.convection.develops && c.cost.level === 'MINIMO',
    failureAnalysis: (e, c) =>
      e.convection.develops
        ? [`Hai ottenuto la tempesta con un intervento ${c.cost.level.toLowerCase()}. Si può fare con meno?`]
        : [convectionReason(e)],
    successAnalysis: (e, c) => ({
      headline: 'TEMPESTA CON INTERVENTO MINIMO.',
      reasons: [
        `${surfaceChange(e, c)} è bastata: l’energia convettiva didattica passa da ${cape(c.baseline)} a ${cape(e)}.`,
        'Nell’aria di questo scenario mancava poco: un piccolo cambiamento nella grandezza giusta conta più di un grande cambiamento in quella sbagliata.',
      ],
    }),
    hintRules: [
      ...noConvectionHints(),
      { when: (e) => e.convection.develops, text: 'Prova a cambiare una sola grandezza alla volta: quale ha l’effetto maggiore?' },
    ],
  },
];

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Fattore fisico il cui contributo è diminuito di più rispetto all'inizio dello scenario. */
function mostReduced<K extends string>(
  before: Readonly<Record<K, { score: number }>>,
  after: Readonly<Record<K, { score: number }>>,
): K | null {
  let best: K | null = null;
  let drop = 0.01;
  for (const key of Object.keys(after) as K[]) {
    const delta = before[key].score - after[key].score;
    if (delta > drop) {
      drop = delta;
      best = key;
    }
  }
  return best;
}

function fromTo(before: number | null, after: number | null, unit: string, decimals = 0): string {
  return before === null || after === null ? '' : ` da ${n(before, decimals)} a ${n(after, decimals)} ${unit}`;
}

/** Perché la grandine si è fermata: il fattore che l'esperimento ha davvero cambiato. */
function stoppedHail(e: MissionEvaluation, c: MissionContext): string {
  const before = c.baseline.severe.hail.factors;
  const after = e.severe.hail.factors;
  switch (mostReduced(before, after)) {
    case 'updraft':
      return `l’updraft è sceso${fromTo(before.updraft.value, after.updraft.value, 'm/s')} nel modello: non sostiene più i chicchi abbastanza a lungo perché crescano.`;
    case 'growthZone':
      return 'la nube non raggiunge più in profondità la zona fra −10 °C e −30 °C, dove il ghiaccio cresce.';
    case 'lapseRate':
      return 'l’aria in quota offre ora meno energia nella zona di crescita del ghiaccio.';
    default:
      return lowerFirst(hailExplanation(e.severe.hail, e.convection));
  }
}

/** Perché il downburst si è fermato: il fattore che l'esperimento ha davvero cambiato. */
function stoppedDownburst(e: MissionEvaluation, c: MissionContext): string {
  const before = c.baseline.severe.downburst.factors;
  const after = e.severe.downburst.factors;
  switch (mostReduced(before, after)) {
    case 'evaporation':
      return 'l’aria sotto la nube non ha più favorito una corrente discendente sufficientemente intensa: meno evaporazione, meno raffreddamento.';
    case 'dcape':
      return `l’aria raffreddata non diventa più abbastanza fredda rispetto all’ambiente: la DCAPE didattica è scesa${fromTo(before.dcape.value, after.dcape.value, 'J/kg')}.`;
    case 'loading':
      return `il nucleo di precipitazione è meno intenso${fromTo(before.loading.value, after.loading.value, 'dBZ')}: non trascina più l’aria verso il basso.`;
    case 'lapseRate':
      return 'lo strato vicino al suolo è ora più stabile e frena l’aria che scende.';
    default:
      return 'la corrente discendente non raggiunge più il suolo.';
  }
}

export function missionById(id: MissionId): MissionDefinition {
  const mission = MISSIONS.find((item) => item.id === id);
  if (!mission) throw new Error(`Missione sconosciuta: ${id}`);
  return mission;
}
