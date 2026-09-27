import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ObservationPanel } from './components/ObservationPanel';
import { ScenarioList } from './components/ScenarioList';
import { TempestaLabPanel } from './components/TempestaLabPanel';
import type { AppStatus } from './components/StatusBadge';
import { formatCoordinates, formatDateTime } from './components/format';
import { useOnlineStatus } from './components/useOnlineStatus';
import { AtmosphereEngine } from './engine/AtmosphereEngine';
import type { MapPoint, MapPrompt } from './map/MapView';
import type { AtmosphericProfile } from './models/AtmosphericProfile';
import type { AtmosphericState } from './models/AtmosphericState';
import type { SimulationParameters, SimulationState } from './models/SimulationState';
import { defaultProvider } from './providers';
import { describeProviderError } from './providers/WeatherProvider';
import {
  deleteScenario,
  listScenarios,
  loadLastObservation,
  loadLastProfile,
  saveLastObservation,
  saveLastProfile,
  saveScenario,
  type SavedScenario,
} from './storage/localStore';

const MapView = lazy(() => import('./map/MapView'));

/** Intervallo tra due passi della timeline durante la riproduzione (tempo per osservare la mappa). */
const PLAYBACK_INTERVAL_MS = 1800;
/** Oltre questa età un dato ricevuto non è più presentato come LIVE. */
const LIVE_MAX_AGE_MS = 30 * 60_000;

interface ObservationEntry {
  readonly state: AtmosphericState;
  /** 'live' = ricevuto in questa sessione; 'stored' = letto dalla memoria locale. */
  readonly kind: 'live' | 'stored';
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function App() {
  const engine = useMemo(() => new AtmosphereEngine(), []);
  const provider = defaultProvider;
  const online = useOnlineStatus();
  const now = useNow(60_000);

  const [point, setPoint] = useState<MapPoint | null>(null);
  const [observation, setObservation] = useState<ObservationEntry | null>(null);
  /** PROFILO ATMOSFERICO (modellistico) del punto dell'osservazione corrente. */
  const [profile, setProfile] = useState<AtmosphericProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const pointRequestedRef = useRef(false);

  // Ultima osservazione e scenari salvati localmente.
  useEffect(() => {
    Promise.all([loadLastObservation(), loadLastProfile().catch(() => null)])
      .then(([stored, storedProfile]) => {
        // Se nel frattempo l'utente ha già scelto un punto, il dato memorizzato non serve più.
        if (!stored || pointRequestedRef.current) return;
        setObservation({ state: stored, kind: 'stored' });
        setProfile(storedProfile);
      })
      .catch(() => undefined);
    listScenarios()
      .then(setScenarios)
      .catch(() => undefined);
  }, []);

  const isLive =
    observation !== null &&
    observation.kind === 'live' &&
    online &&
    now - Date.parse(observation.state.source.fetchedAt) < LIVE_MAX_AGE_MS;

  const status: AppStatus = simulation ? 'sim' : !online ? 'offline' : observation && !isLive ? 'last' : 'live';

  const requestObservation = useCallback(
    async (target: MapPoint) => {
      pointRequestedRef.current = true;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setPoint(target);
      setLoading(true);
      setError(null);
      // Il profilo è richiesto in parallelo; se non arriva l'osservazione resta valida.
      const profileRequest = provider.getProfile
        ? provider.getProfile(target.latitude, target.longitude, { signal: controller.signal }).catch(() => null)
        : Promise.resolve(null);
      try {
        const [state, pointProfile] = await Promise.all([
          provider.getCurrentState(target.latitude, target.longitude, { signal: controller.signal }),
          profileRequest,
        ]);
        if (controller.signal.aborted) return;
        setObservation({ state, kind: 'live' });
        setProfile(pointProfile);
        saveLastObservation(state).catch(() => undefined);
        saveLastProfile(pointProfile).catch(() => undefined);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(describeProviderError(caught));
        // Nessun dato per il nuovo punto: si mostra l'ultima osservazione memorizzata, dichiarandola tale.
        const stored = await loadLastObservation().catch(() => null);
        const storedProfile = stored ? await loadLastProfile().catch(() => null) : null;
        setObservation(stored ? { state: stored, kind: 'stored' } : null);
        setProfile(storedProfile);
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    },
    [provider],
  );

  const handleSelect = useCallback(
    (target: MapPoint) => {
      if (simulation) return; // In SIM lo stato iniziale è congelato.
      void requestObservation(target);
    },
    [simulation, requestObservation],
  );

  // Riproduzione della timeline.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setSimulation((current) => {
        if (!current) return current;
        const next = engine.advance(current);
        if (engine.isFinished(next)) setPlaying(false);
        return next;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, engine]);

  const enterLab = () => {
    if (!observation) return;
    setSimulation(engine.createSimulation(observation.state, { originKind: isLive ? 'live' : 'last-observation', profile }));
    setPlaying(false);
    setSaveMessage(null);
  };

  const startExperiment = () => {
    if (!simulation) return;
    const started = engine.startExperiment(simulation);
    setSimulation(started);
    setPlaying(started.convection?.develops ?? false);
  };

  const modifyAtmosphere = () => {
    setPlaying(false);
    setSimulation((current) => (current ? engine.clearExperiment(current) : current));
  };

  const restoreRealValues = () => {
    setPlaying(false);
    setSimulation((current) => (current ? engine.reset(current) : current));
  };

  const seek = (minute: number) => {
    setPlaying(false);
    setSimulation((current) => (current ? engine.seek(current, minute) : current));
  };

  const openScenario = (scenario: SavedScenario) => {
    const base = engine.createSimulation(scenario.origin, { originKind: 'scenario', profile: scenario.profile ?? null });
    setSimulation(engine.withParameters(base, scenario.parameters));
    setPlaying(false);
    setSaveMessage(null);
  };

  const removeScenario = (scenario: SavedScenario) => {
    deleteScenario(scenario.id)
      .then(listScenarios)
      .then(setScenarios)
      .catch(() => undefined);
  };

  const backToLive = () => {
    setPlaying(false);
    setSimulation(null);
    setSaveMessage(null);
  };

  const changeParameter = (key: keyof SimulationParameters, value: number) => {
    setPlaying(false);
    setSimulation((current) => (current ? engine.withParameters(current, { [key]: value }) : current));
  };

  const saveCurrentScenario = () => {
    if (!simulation) return;
    const savedAt = new Date().toISOString();
    const scenario: SavedScenario = {
      id: `${simulation.id}-${Date.parse(savedAt)}`,
      name: `${formatCoordinates(simulation.origin.latitude, simulation.origin.longitude)} · ${formatDateTime(simulation.origin.timestamp)}`,
      savedAt,
      origin: simulation.origin,
      parameters: simulation.parameters,
      profile: simulation.profile,
    };
    saveScenario(scenario)
      .then(listScenarios)
      .then((items) => {
        setScenarios(items);
        setSaveMessage('Scenario salvato sul dispositivo.');
      })
      .catch(() => setSaveMessage('Impossibile salvare lo scenario su questo dispositivo.'));
  };

  const mapPoint = simulation
    ? { latitude: simulation.origin.latitude, longitude: simulation.origin.longitude }
    : (point ?? (observation ? { latitude: observation.state.latitude, longitude: observation.state.longitude } : null));

  const mapPrompt: MapPrompt | null = simulation
    ? null
    : loading
      ? 'loading'
      : observation && point && !error
        ? 'acquired'
        : 'pick';

  return (
    <div className={`app app--${simulation ? 'sim' : 'live'}`}>
      <a className="skip-link" href="#console">
        Vai ai dati
      </a>
      <Header status={status} />

      {!online && (
        <p className="offline-bar" role="status">
          <strong>OFFLINE</strong> — interfaccia, simulazioni e scenari salvati restano disponibili. Nessun dato reale
          aggiornato.
        </p>
      )}

      <main className="layout">
        <div className="layout__map">
          <Suspense fallback={<div className="map-frame map-frame--loading">Caricamento mappa…</div>}>
            <MapView
              selected={mapPoint}
              onSelect={handleSelect}
              mode={simulation ? 'sim' : 'live'}
              prompt={mapPrompt}
              experiment={simulation?.convection ?? null}
              severe={simulation?.severe ?? null}
              minute={simulation?.currentMinute ?? 0}
            />
          </Suspense>
          {simulation && (
            <p className="map-hint">In SIM la condizione iniziale è congelata: torna al LIVE per selezionare un altro punto.</p>
          )}
        </div>

        <div className="layout__console" id="console" tabIndex={-1}>
          {simulation ? (
            <TempestaLabPanel
              simulation={simulation}
              playing={playing}
              finished={engine.isFinished(simulation)}
              onChangeParameter={changeParameter}
              onRestoreReal={restoreRealValues}
              onStart={startExperiment}
              onModify={modifyAtmosphere}
              onPlay={() => {
                if (!engine.isFinished(simulation)) setPlaying(true);
              }}
              onPause={() => setPlaying(false)}
              onStep={() => {
                setPlaying(false);
                setSimulation((current) => (current ? engine.advance(current) : current));
              }}
              onRestart={() => seek(0)}
              onSeek={seek}
              onBackToLive={backToLive}
              onSave={saveCurrentScenario}
              saveMessage={saveMessage}
            />
          ) : (
            <ObservationPanel
              observation={observation?.state ?? null}
              isLive={isLive}
              loading={loading}
              error={error}
              attribution={provider.attribution}
              onEnterLab={enterLab}
              profile={profile}
            />
          )}
          <ScenarioList scenarios={scenarios} onOpen={openScenario} onDelete={removeScenario} />
        </div>
      </main>

      <Footer version={__APP_VERSION__} />
    </div>
  );
}
