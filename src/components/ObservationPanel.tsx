import type { AtmosphericState } from '../models/AtmosphericState';
import {
  describeWeatherCode,
  formatCoordinates,
  formatDateTime,
  formatDirection,
  formatValue,
} from './format';
import { MetricGrid, type Metric } from './MetricGrid';

interface ObservationPanelProps {
  readonly observation: AtmosphericState | null;
  /** true = dato LIVE; false = ultima osservazione memorizzata (mai presentata come LIVE). */
  readonly isLive: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly attribution: { readonly text: string; readonly url: string };
  readonly onCreateSimulation: () => void;
}

export function observationMetrics(o: AtmosphericState): Metric[] {
  return [
    {
      key: 'temperature',
      label: 'Temperatura',
      value: formatValue(o.temperature, '°C'),
      detail: `Percepita ${formatValue(o.apparentTemperature, '°C')} · Rugiada ${formatValue(o.dewPoint, '°C')}`,
    },
    { key: 'humidity', label: 'Umidità', value: formatValue(o.relativeHumidity, '%', 0) },
    {
      key: 'pressure',
      label: 'Pressione',
      value: formatValue(o.pressure, 'hPa'),
      detail: `Livello del mare · al suolo ${formatValue(o.surfacePressure, 'hPa')}`,
    },
    {
      key: 'wind',
      label: 'Vento',
      value: formatValue(o.windSpeed, 'km/h'),
      detail: `Da ${formatDirection(o.windDirection)}`,
    },
    { key: 'gust', label: 'Raffiche', value: formatValue(o.windGust, 'km/h') },
    {
      key: 'precipitation',
      label: 'Precipitazioni',
      value: formatValue(o.precipitation, 'mm'),
      detail: `Pioggia ${formatValue(o.rain, 'mm')} · rovesci ${formatValue(o.showers, 'mm')}`,
    },
    {
      key: 'cloud',
      label: 'Nuvolosità',
      value: formatValue(o.cloudCover, '%', 0),
      detail: describeWeatherCode(o.weatherCode),
    },
  ];
}

export function ObservationPanel(props: ObservationPanelProps) {
  const { observation, isLive, loading, error, attribution, onCreateSimulation } = props;

  return (
    <section className="panel panel--observation" aria-labelledby="observation-title">
      <div className="panel__head">
        <h2 id="observation-title" className="panel__title">
          {isLive ? 'Osservazione LIVE' : observation ? 'ULTIMA OSSERVAZIONE' : 'Osservazione'}
        </h2>
        {loading && (
          <p className="panel__note" role="status">
            Richiesta dati in corso…
          </p>
        )}
      </div>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {!observation && !loading && (
        <p className="panel__empty">Seleziona un punto sulla mappa per richiedere lo stato atmosferico reale.</p>
      )}

      {observation && (
        <>
          <p className="panel__meta">
            <span>{formatCoordinates(observation.latitude, observation.longitude)}</span>
            <span>
              {isLive ? 'Valido alle ' : 'Osservazione del '}
              <time dateTime={observation.timestamp}>{formatDateTime(observation.timestamp)}</time>
            </span>
          </p>
          {!isLive && (
            <p className="panel__note">
              Dato memorizzato sul dispositivo, non aggiornato. Non è un dato LIVE.
            </p>
          )}
          <MetricGrid metrics={observationMetrics(observation)} tag={isLive ? 'LIVE' : 'ULTIMA'} />
          <p className="panel__source">
            Fonte: {observation.source.providerName} ·{' '}
            <a href={attribution.url} target="_blank" rel="noopener noreferrer">
              {attribution.text}
            </a>
          </p>
          <button type="button" className="button button--primary" onClick={onCreateSimulation}>
            CREA SIMULAZIONE
          </button>
        </>
      )}
    </section>
  );
}
