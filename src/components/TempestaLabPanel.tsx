import { useId, useState } from 'react';
import type { ConvectiveOutlook } from '../engine/ConvectiveEngine';
import type { SevereOutlook } from '../engine/SevereWeather';
import type { SurfaceAir } from '../engine/VerticalProfileEngine';
import {
  type AssumedField,
  type SimulationParameters,
  type SimulationState,
} from '../models/SimulationState';

import { outcomeTitle, summarize } from '../simulation/tempestaNarrative';
import { formatOffset } from '../simulation/timeline';
import {
  HAIL_SIZE_LABELS,
  OUTFLOW_LABELS,
  SEVERE_TITLES,
  downburstExplanation,
  formatIndex,
  hailExplanation,
  severeResult,
} from '../simulation/severeNarrative';
import { AtmosphereControls, ExperimentPlayer, formatDelta, parameterChanges } from './ExperimentParts';
import { ProfileView } from './ProfileView';
import { formatCoordinates, formatDateTime, formatValue } from './format';

interface TempestaLabPanelProps {
  readonly simulation: SimulationState;
  readonly playing: boolean;
  readonly finished: boolean;
  readonly onChangeParameter: (key: keyof SimulationParameters, value: number) => void;
  readonly onRestoreReal: () => void;
  readonly onStart: () => void;
  readonly onModify: () => void;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onRestart: () => void;
  readonly onSeek: (minute: number) => void;
  readonly onBackToLive: () => void;
  readonly onSave: () => void;
  readonly saveMessage: string | null;
}


const ASSUMED_LABELS: Record<AssumedField, string> = {
  temperature: 'temperatura',
  relativeHumidity: 'umidità',
  windSpeed: 'vento',
  cloudCover: 'nuvolosità',
};

const ORIGIN_LABELS: Record<SimulationState['originKind'], string> = {
  live: 'osservazione LIVE',
  'last-observation': 'ultima osservazione memorizzata',
  scenario: 'scenario salvato',
  didactic: 'SCENARIO DIDATTICO',
};


export type Mission = 1 | 2 | 3;

const MISSIONS: Record<Mission, { title: string; text: readonly string[] }> = {
  1: { title: 'CREA UNA TEMPESTA', text: ['Modifica l’atmosfera.', 'Riesci a creare le condizioni per lo sviluppo di un temporale?'] },
  2: {
    title: 'GRANDINE',
    text: [
      'Una corrente ascensionale intensa può mantenere le particelle di ghiaccio nella nube abbastanza a lungo da farle crescere.',
      'Riesci a creare le condizioni favorevoli?',
    ],
  },
  3: {
    title: 'DOWNBURST',
    text: [
      'Precipitazioni intense e raffreddamento dell’aria possono accelerare una corrente discendente.',
      'Riesci a produrre un downburst?',
    ],
  },
};

function realSurface(simulation: SimulationState): SurfaceAir | null {
  const { temperature, relativeHumidity, windSpeed, windDirection } = simulation.origin;
  if (temperature === null || relativeHumidity === null) return null;
  return { temperature, relativeHumidity, windSpeed: windSpeed ?? 0, windDirection };
}

function simSurface(simulation: SimulationState): SurfaceAir {
  return { ...simulation.parameters, windDirection: simulation.origin.windDirection };
}


export function TempestaLabPanel(props: TempestaLabPanelProps) {
  const { simulation } = props;
  const baseId = useId();
  const outlook = simulation.convection;
  const [mission, setMission] = useState<Mission>(1);
  const [showProfile, setShowProfile] = useState(false);

  return (
    <section className="panel panel--sim" aria-labelledby={`${baseId}-title`}>
      <div className="sim-banner" role="note">
        <strong>SIMULAZIONE DIDATTICA</strong>
        <span>NON È UNA PREVISIONE METEOROLOGICA</span>
      </div>

      <div className="panel__head">
        <h2 id={`${baseId}-title`} className="panel__title lab-title">
          TEMPESTA LAB
        </h2>
        <button
          type="button"
          className="button button--small button--ghost"
          aria-pressed={showProfile}
          onClick={() => setShowProfile((value) => !value)}
        >
          PROFILO
        </button>
      </div>
      <p className="panel__meta">
        <span>{formatCoordinates(simulation.origin.latitude, simulation.origin.longitude)}</span>
        <span>
          Partenza: {ORIGIN_LABELS[simulation.originKind]} del{' '}
          <time dateTime={simulation.origin.timestamp}>{formatDateTime(simulation.origin.timestamp)}</time>
        </span>
      </p>

      {showProfile && <ProfileView profile={simulation.profile} real={realSurface(simulation)} sim={simSurface(simulation)} />}

      {!outlook ? (
        <LabSetup {...props} baseId={baseId} mission={mission} onMission={setMission} />
      ) : (
        <Experiment {...props} outlook={outlook} severe={simulation.severe} mission={mission} />
      )}

      <details className="sim-table">
        <summary>Dati di superficie simulati T+0 … T+90</summary>
        <div className="table-scroll">
          <table>
            <caption>Valori simulati (SIM) al suolo per ogni passo della timeline</caption>
            <thead>
              <tr>
                <th scope="col">Tempo</th>
                <th scope="col">Temp. °C</th>
                <th scope="col">Rugiada °C</th>
                <th scope="col">Umidità %</th>
                <th scope="col">Vento km/h</th>
                <th scope="col">Nubi %</th>
              </tr>
            </thead>
            <tbody>
              {simulation.timeline.map((item) => (
                <tr key={item.minute} aria-current={item.minute === simulation.currentMinute ? 'step' : undefined}>
                  <th scope="row">{formatOffset(item.minute)}</th>
                  <td>{item.temperature.toFixed(1)}</td>
                  <td>{item.dewPoint.toFixed(1)}</td>
                  <td>{item.relativeHumidity.toFixed(0)}</td>
                  <td>{item.windSpeed.toFixed(1)}</td>
                  <td>{item.cloudCover.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="sim-rules">
        <summary>Come funziona il modello didattico</summary>
        <ul>
          <li>
            L’aria vicino al suolo, con temperatura e umidità scelte da te, viene sollevata: si raffredda finché il
            vapore condensa (base delle nubi), poi continua a salire più lentamente.
          </li>
          <li>
            L’aria in quota è quella del PROFILO ATMOSFERICO (Open-Meteo: dato dei modelli numerici, non un
            radiosondaggio). Se il profilo manca si usa un profilo standard ipotizzato (−6,5 °C/km).
          </li>
          <li>
            Grandine e downburst sono valutati solo con il profilo: updraft, zero termico, aria fredda o secca in
            quota, vento che cambia con la quota. Gli indici sono didattici, non probabilità.
          </li>
          <li>
            Se l’aria sollevata resta più calda dell’ambiente accumula energia (una «CAPE didattica», non la CAPE
            reale): più energia significa corrente ascendente più forte e nucleo radar più intenso.
          </li>
          <li>
            Il vento sposta la cella e, se è moderato, ne organizza di nuove; se è troppo forte rispetto
            all’energia disponibile la disperde.
          </li>
          <li>Il radar è disegnato dal modello: nessuna immagine radar reale viene usata.</li>
        </ul>
      </details>

      <div className="controls-row">
        <button type="button" className="button button--ghost" onClick={props.onSave}>
          SALVA SCENARIO
        </button>
        <button type="button" className="button button--ghost" onClick={props.onBackToLive}>
          TORNA AL LIVE
        </button>
        {props.saveMessage && (
          <p className="panel__note" role="status">
            {props.saveMessage}
          </p>
        )}
      </div>
    </section>
  );
}

function LabSetup(
  props: TempestaLabPanelProps & { readonly baseId: string; readonly mission: Mission; readonly onMission: (mission: Mission) => void },
) {
  const { simulation, baseId, mission } = props;
  const current = MISSIONS[mission];
  return (
    <>
      <div className="missions" role="group" aria-label="Missioni">
        {([1, 2, 3] as const).map((id) => (
          <button key={id} type="button" className="missions__tab" aria-pressed={id === mission} onClick={() => props.onMission(id)}>
            0{id}
          </button>
        ))}
      </div>
      <div className="mission">
        <p className="mission__tag">
          MISSIONE 0{mission} · {current.title}
        </p>
        <p className="mission__text">
          {current.text.map((line, index) => (
            <span key={index}>
              {index > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
        {mission > 1 && !simulation.profile && (
          <p className="panel__note">DATI VERTICALI INSUFFICIENTI: senza profilo atmosferico la missione non può essere valutata.</p>
        )}
      </div>

      {simulation.assumed.length > 0 && (
        <p className="panel__note">
          Dati mancanti nell&apos;osservazione, sostituiti da valori didattici ipotizzati:{' '}
          {simulation.assumed.map((field) => ASSUMED_LABELS[field]).join(', ')}.
        </p>
      )}

      <AtmosphereControls simulation={simulation} baseId={baseId} referenceLabel="REALE" onChange={props.onChangeParameter}>
        <button type="button" className="button button--small button--ghost" onClick={props.onRestoreReal}>
          Ripristina valori reali
        </button>
      </AtmosphereControls>

      <button type="button" className="button button--start" onClick={props.onStart}>
        AVVIA ESPERIMENTO
      </button>
    </>
  );
}

function Experiment(
  props: TempestaLabPanelProps & { readonly outlook: ConvectiveOutlook; readonly severe: SevereOutlook | null; readonly mission: Mission },
) {
  const { simulation, outlook, playing, finished, severe, mission } = props;
  const changes = parameterChanges(simulation);
  const minute = simulation.currentMinute;
  const frame = outlook.frames.find((item) => item.minute === minute);
  const summary = summarize(outlook, simulation.parameters, changes);
  const developed = outlook.develops;

  return (
    <>
      <p className={`outcome ${developed ? 'outcome--storm' : 'outcome--none'}`} role="status">
        {outcomeTitle(outlook)}
      </p>

      {developed && severe && (
        <p className={`severe-outcome severe-outcome--${severeResult(severe).toLowerCase()}`}>
          {severe.vertical.available ? SEVERE_TITLES[severeResult(severe)] : 'GRANDINE / DOWNBURST: DATI VERTICALI INSUFFICIENTI'}
        </p>
      )}

      {!developed && <p className="lab-sentence">{summary.explanation}</p>}

      {developed && frame && (
        <>
          <ExperimentPlayer
            simulation={simulation}
            outlook={outlook}
            severe={severe}
            playing={playing}
            finished={finished}
            onPlay={props.onPlay}
            onPause={props.onPause}
            onStep={props.onStep}
            onRestart={props.onRestart}
            onSeek={props.onSeek}
          />
        </>
      )}

      {(!developed || finished) && (
        <div className="result">
          <p className="result__title">ESPERIMENTO COMPLETATO</p>
          <dl className="result__list">
            <div>
              <dt>Condizioni reali</dt>
              <dd>
                {formatValue(simulation.origin.temperature, '°C')} · {formatValue(simulation.origin.relativeHumidity, '%', 0)} ·{' '}
                {formatValue(simulation.origin.windSpeed, 'km/h', 0)}
              </dd>
            </div>
            <div>
              <dt>Modifiche</dt>
              <dd>
                {formatDelta(changes.temperature, '°C', 1)} · {formatDelta(changes.relativeHumidity, '%', 0)} ·{' '}
                {formatDelta(changes.windSpeed, 'km/h', 0)}
              </dd>
            </div>
            {developed && (
              <>
                <div>
                  <dt>Intensità massima</dt>
                  <dd>
                    {summary.peakReflectivity.toFixed(0)} dBZ ({summary.peakBandLabel}) ·{' '}
                    {formatValue(summary.peakRainRate, 'mm/h', 0)}
                  </dd>
                </div>
                <div>
                  <dt>Durata della cella</dt>
                  <dd>
                    {summary.stillActive ? `almeno ${summary.durationMinutes} min (ancora attiva a T+90)` : `${summary.durationMinutes} min`}
                  </dd>
                </div>
                <div>
                  <dt>Spostamento</dt>
                  <dd>
                    {summary.displacementKm < 0.5
                      ? 'quasi nullo'
                      : `${formatValue(summary.displacementKm, 'km', 0)} verso ${summary.displacementDirection}`}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {developed && <p className="lab-sentence">{summary.explanation}</p>}
          {developed && severe && <SevereResults severe={severe} convection={outlook} mission={mission} />}
        </div>
      )}

      <button type="button" className="button button--sim button--wide" onClick={props.onModify}>
        {developed ? 'MODIFICA L’ATMOSFERA' : 'MODIFICA L’ATMOSFERA E RIPROVA'}
      </button>
    </>
  );
}

function SevereResults(props: { readonly severe: SevereOutlook; readonly convection: ConvectiveOutlook; readonly mission: Mission }) {
  const { severe, convection, mission } = props;
  const cloudBase = severe.vertical.available ? severe.vertical.cloudBase : null;
  const blocks = [
    {
      key: 'hail',
      title: 'GRANDINE',
      available: severe.hail.available,
      occurs: severe.hail.occurs,
      index: severe.hail.hailPotential,
      detail: severe.hail.occurs ? `classe didattica: ${HAIL_SIZE_LABELS[severe.hail.hailSizeClass]}` : null,
      text: hailExplanation(severe.hail, convection),
    },
    {
      key: 'burst',
      title: 'DOWNBURST',
      available: severe.downburst.available,
      occurs: severe.downburst.occurs,
      index: severe.downburst.downburstPotential,
      detail:
        severe.downburst.occurs && severe.downburst.outflowSpeedClass
          ? `outflow ${OUTFLOW_LABELS[severe.downburst.outflowSpeedClass]} · fronte fino a ${formatValue(severe.downburst.outflowRadius, 'km', 0)}`
          : null,
      text: downburstExplanation(severe.downburst, convection, cloudBase),
    },
  ];
  if (mission === 3) blocks.reverse();
  return (
    <div className="severe-results">
      {blocks.map((block) => (
        <section key={block.key} className={`severe-block severe-block--${block.key}`}>
          <h4 className="severe-block__title">
            {block.title} ·{' '}
            {!block.available ? 'DATI VERTICALI INSUFFICIENTI' : block.occurs ? 'PERCHÉ È SUCCESSO' : 'PERCHÉ NON È SUCCESSO'}
          </h4>
          {block.available && (
            <p className="severe-block__meta">
              indice didattico {formatIndex(block.index)} (non è una probabilità){block.detail ? ` · ${block.detail}` : ''}
            </p>
          )}
          <p className="lab-sentence">{block.text}</p>
        </section>
      ))}
    </div>
  );
}
