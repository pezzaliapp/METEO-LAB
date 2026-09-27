import { useState } from 'react';
import type { MissionId, MissionSourceKind } from '../game/MissionEngine';
import { MISSIONS } from '../game/missions';
import { isHighlighted, type MissionProgress } from '../game/progress';
import { SCENARIOS } from '../game/scenarios';
import type { AtmosphericState } from '../models/AtmosphericState';
import { formatCoordinates } from './format';

interface MissionControlProps {
  readonly progress: MissionProgress;
  /** Osservazione del punto scelto (per LIVE CHALLENGE); null se nessun punto. */
  readonly liveObservation: AtmosphericState | null;
  readonly liveHasProfile: boolean;
  readonly onPlay: (id: MissionId, source: MissionSourceKind) => void;
}

/** MISSION CONTROL — elenco delle missioni con sblocco morbido. */
export function MissionControl({ progress, liveObservation, liveHasProfile, onPlay }: MissionControlProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = MISSIONS.filter((mission) => showAll || isHighlighted(progress, mission.id));
  const hidden = MISSIONS.length - visible.length;

  return (
    <section className="panel panel--missions" aria-labelledby="mission-control-title">
      <h2 id="mission-control-title" className="panel__title mission-control__title">
        MISSION CONTROL
      </h2>
      <p className="panel__note">
        Ogni missione è un esperimento: osserva, formula un’ipotesi, modifica l’atmosfera al suolo, avvia e scopri perché.
        Le missioni usano SCENARI DIDATTICI congelati: stessi dati ogni giorno, stessi risultati.
      </p>

      <ol className="mission-list">
        {visible.map((mission) => {
          const record = progress.missions[mission.id];
          const done = record?.completed === true;
          const status = done
            ? `✓ COMPLETATA · ${record.attempts} ${record.attempts === 1 ? 'tentativo' : 'tentativi'}`
            : record
              ? `IN CORSO · ${record.attempts} ${record.attempts === 1 ? 'tentativo' : 'tentativi'}`
              : 'DA GIOCARE';
          const highlighted = isHighlighted(progress, mission.id);
          const liveAvailable = mission.liveChallenge && liveObservation !== null;
          return (
            <li key={mission.id} className={`mission-item${done ? ' mission-item--done' : ''}${highlighted ? '' : ' mission-item--later'}`}>
              <div className="mission-item__head">
                <span className="mission-item__number">{mission.id}</span>
                <span className="mission-item__title">{mission.title}</span>
              </div>
              <p className="mission-item__objective">{mission.objective}</p>
              <p className="mission-item__meta">
                <span>{status}</span>
                <span>SCENARIO DIDATTICO · {SCENARIOS[mission.scenario].name}</span>
                {!highlighted && <span>consigliata più avanti</span>}
              </p>
              <div className="controls-row">
                <button
                  type="button"
                  className="button button--sim"
                  onClick={() => onPlay(mission.id, 'scenario')}
                  aria-label={`Gioca la missione ${mission.id}, ${mission.title}, con lo scenario didattico`}
                >
                  {done ? 'RIGIOCA' : 'GIOCA'}
                </button>
                {mission.liveChallenge && (
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={!liveAvailable}
                    onClick={() => onPlay(mission.id, 'live')}
                    aria-label={`LIVE CHALLENGE della missione ${mission.id} con le condizioni del punto scelto`}
                  >
                    LIVE CHALLENGE
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <button type="button" className="button button--ghost button--wide" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'MOSTRA SOLO LE MISSIONI CONSIGLIATE' : `MOSTRA TUTTE LE MISSIONI${hidden > 0 ? ` (+${hidden})` : ''}`}
      </button>

      <div className="live-challenge">
        <p className="live-challenge__title">LIVE CHALLENGE · modalità avanzata</p>
        <p className="panel__note">
          Parte dalle CONDIZIONI METEOROLOGICHE DEL MOMENTO nel punto scelto sulla mappa (ESPERIMENTO SIMULATO). Con il
          meteo di oggi alcuni fenomeni possono essere impossibili: il gioco lo dice.
        </p>
        <p className="panel__note">
          {liveObservation
            ? `Punto scelto: ${formatCoordinates(liveObservation.latitude, liveObservation.longitude)}${liveHasProfile ? '' : ' · profilo verticale non disponibile'}`
            : 'Scegli un punto sulla mappa per abilitare le LIVE CHALLENGE.'}
        </p>
      </div>
    </section>
  );
}
