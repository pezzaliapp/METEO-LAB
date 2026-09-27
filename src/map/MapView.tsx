import { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { offsetPoint, type ConvectiveOutlook } from '../engine/ConvectiveEngine';
import { hailAt, hailGeometry, outflowAt, outflowGeometry } from '../engine/SevereGeometry';
import type { SevereOutlook } from '../engine/SevereWeather';
import { RADAR_BANDS, radarAt, type RadarFeatureCollection } from '../engine/SimulatedRadar';
import { STAGE_LABELS } from '../simulation/tempestaNarrative';
import { formatOffset } from '../simulation/timeline';

/**
 * Mappa MapLibre GL — vista iniziale sull'Italia.
 * Tile vettoriali OpenFreeMap (gratuite, senza chiave API, dati © OpenStreetMap).
 * La posizione dell'utente non viene mai richiesta.
 *
 * In SIM mostra il layer RADAR SIMULATO generato dal ConvectiveEngine
 * (nessuna immagine radar reale) e la traiettoria della cella.
 */
setWorkerUrl(workerUrl);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const ITALY_CENTER: [number, number] = [12.5, 42.1];
const ITALY_ZOOM = 4.8;
/** Durata della transizione animata fra due passi della timeline. */
const TWEEN_MS = 1100;

const RADAR_SOURCE = 'sim-radar';
const TRACK_SOURCE = 'sim-track';
const HAIL_SOURCE = 'sim-hail';
const OUTFLOW_SOURCE = 'sim-outflow';
/** Colori dei fenomeni: distinti dalla scala radar e dal verde/acqua LIVE. */
export const HAIL_COLOR = '#ece8ff';
export const OUTFLOW_COLOR = '#5ab4ff';
const EMPTY: RadarFeatureCollection = { type: 'FeatureCollection', features: [] };

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export interface MapPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** Messaggio guida mostrato sulla mappa in LIVE. */
export type MapPrompt = 'pick' | 'loading' | 'acquired';

const PROMPTS: Record<MapPrompt, string> = {
  pick: 'SCEGLI UN PUNTO SULLA MAPPA',
  loading: 'ACQUISIZIONE DATI REALI…',
  acquired: 'OSSERVAZIONE ACQUISITA',
};

interface MapViewProps {
  readonly selected: MapPoint | null;
  readonly onSelect: (point: MapPoint) => void;
  readonly mode: 'live' | 'sim';
  readonly prompt: MapPrompt | null;
  /** Esperimento TEMPESTA LAB in corso (null = nessun radar simulato). */
  readonly experiment: ConvectiveOutlook | null;
  /** Minuto corrente della timeline dell'esperimento. */
  readonly minute: number;
  /** GRANDINE e DOWNBURST dell'esperimento (null = assenti o non valutati). */
  readonly severe: SevereOutlook | null;
}

function trackData(outlook: ConvectiveOutlook) {
  const active = outlook.frames.filter((frame) => frame.stage !== 'NONE');
  // Senza cella non c'è traiettoria da mostrare.
  if (active.length === 0) return EMPTY;
  const coordinates = outlook.frames.map((frame) => [frame.center.longitude, frame.center.latitude]);
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...(outlook.cellSpeed >= 1
        ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } }]
        : []),
      ...outlook.frames.map((frame) => ({
        type: 'Feature' as const,
        properties: { label: formatOffset(frame.minute), active: frame.stage !== 'NONE' },
        geometry: { type: 'Point' as const, coordinates: [frame.center.longitude, frame.center.latitude] },
      })),
    ],
  };
}

function experimentBounds(outlook: ConvectiveOutlook, severe: SevereOutlook | null): LngLatBounds {
  const margin = Math.max(outlook.cellRadius * 1.6, 12);
  const bounds = new LngLatBounds();
  for (const frame of outlook.frames) {
    for (const bearing of [0, 90, 180, 270]) {
      const p = offsetPoint(frame.center, bearing, margin);
      bounds.extend([p.longitude, p.latitude]);
    }
  }
  const impact = severe?.downburst.impactPoint;
  if (impact) {
    for (const bearing of [0, 90, 180, 270]) {
      const p = offsetPoint(impact, bearing, severe.downburst.outflowRadius * 1.3 + 2);
      bounds.extend([p.longitude, p.latitude]);
    }
  }
  return bounds;
}

function addSimulationLayers(map: MapLibreMap): void {
  if (map.getSource(RADAR_SOURCE)) return;
  map.addSource(TRACK_SOURCE, { type: 'geojson', data: EMPTY });
  map.addSource(RADAR_SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'sim-track-line',
    type: 'line',
    source: TRACK_SOURCE,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#e8b04b', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
  });
  map.addLayer({
    id: 'sim-radar-fill',
    type: 'fill',
    source: RADAR_SOURCE,
    layout: { 'fill-sort-key': ['get', 'order'] },
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.78, 'fill-antialias': true },
  });
  map.addLayer({
    id: 'sim-radar-edge',
    type: 'line',
    source: RADAR_SOURCE,
    filter: ['==', ['get', 'band'], 'light'],
    paint: { 'line-color': '#1d6b31', 'line-width': 1, 'line-opacity': 0.9 },
  });
  // GRANDINE SIMULATA: sopra il radar, sobria (contorno tratteggiato + chicchi), non lo copre.
  map.addSource(HAIL_SOURCE, { type: 'geojson', data: EMPTY });
  map.addSource(OUTFLOW_SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'sim-outflow-area',
    type: 'fill',
    source: OUTFLOW_SOURCE,
    filter: ['==', ['get', 'kind'], 'area'],
    paint: { 'fill-color': OUTFLOW_COLOR, 'fill-opacity': ['*', 0.1, ['get', 'strength']] },
  });
  map.addLayer({
    id: 'sim-hail-core',
    type: 'fill',
    source: HAIL_SOURCE,
    filter: ['==', ['get', 'kind'], 'core'],
    paint: { 'fill-color': HAIL_COLOR, 'fill-opacity': 0.22 },
  });
  map.addLayer({
    id: 'sim-hail-edge',
    type: 'line',
    source: HAIL_SOURCE,
    filter: ['==', ['get', 'kind'], 'core'],
    paint: { 'line-color': HAIL_COLOR, 'line-width': 1.6, 'line-dasharray': [2, 1.5] },
  });
  map.addLayer({
    id: 'sim-hail-stones',
    type: 'circle',
    source: HAIL_SOURCE,
    filter: ['==', ['get', 'kind'], 'stone'],
    paint: { 'circle-radius': 2.2, 'circle-color': HAIL_COLOR, 'circle-stroke-color': '#3a3355', 'circle-stroke-width': 0.8 },
  });
  // DOWNBURST OUTFLOW: fronte di raffica blu, distinto dal radar.
  map.addLayer({
    id: 'sim-outflow-front',
    type: 'line',
    source: OUTFLOW_SOURCE,
    filter: ['==', ['get', 'kind'], 'front'],
    paint: { 'line-color': OUTFLOW_COLOR, 'line-width': 3, 'line-opacity': ['get', 'strength'] },
  });
  map.addLayer({
    id: 'sim-outflow-arrows',
    type: 'line',
    source: OUTFLOW_SOURCE,
    filter: ['==', ['get', 'kind'], 'arrow'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': OUTFLOW_COLOR, 'line-width': 2, 'line-opacity': ['get', 'strength'] },
  });
  map.addLayer({
    id: 'sim-outflow-impact',
    type: 'circle',
    source: OUTFLOW_SOURCE,
    filter: ['==', ['get', 'kind'], 'impact'],
    paint: {
      'circle-radius': 5,
      'circle-color': '#0e1418',
      'circle-stroke-color': OUTFLOW_COLOR,
      'circle-stroke-width': 2.5,
      'circle-opacity': ['get', 'strength'],
      'circle-stroke-opacity': ['get', 'strength'],
    },
  });
  map.addLayer({
    id: 'sim-track-points',
    type: 'circle',
    source: TRACK_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 2.5,
      'circle-color': '#0e1418',
      'circle-stroke-color': '#e8b04b',
      'circle-stroke-width': 1.2,
      'circle-opacity': ['case', ['get', 'active'], 1, 0.5],
      'circle-stroke-opacity': ['case', ['get', 'active'], 1, 0.5],
    },
  });
  map.addLayer({
    id: 'sim-track-labels',
    type: 'symbol',
    source: TRACK_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-offset': [0, 1.1],
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#e8b04b', 'text-halo-color': '#0e1418', 'text-halo-width': 1.2 },
  });
  for (const [id, source, color] of [
    ['sim-hail-label', HAIL_SOURCE, HAIL_COLOR],
    ['sim-outflow-label', OUTFLOW_SOURCE, OUTFLOW_COLOR],
  ] as const) {
    map.addLayer({
      id,
      type: 'symbol',
      source,
      filter: ['==', ['get', 'kind'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [0.4, 0],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': color, 'text-halo-color': '#0e1418', 'text-halo-width': 1.6 },
    });
  }
}

export default function MapView({ selected, onSelect, mode, prompt, experiment, minute, severe }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const displayedRef = useRef(0);
  const shownExperimentRef = useRef<ConvectiveOutlook | null>(null);
  const [webglAvailable] = useState(isWebGLAvailable);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !webglAvailable) return;
    const map = new MapLibreMap({
      container,
      style: STYLE_URL,
      center: ITALY_CENTER,
      zoom: ITALY_ZOOM,
      attributionControl: { compact: true },
      keyboard: true,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (event) => {
      onSelectRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    });
    map.on('error', () => {
      if (!map.isStyleLoaded()) setMapError('Mappa non disponibile (connessione assente o servizio tile non raggiungibile).');
    });
    map.on('load', () => {
      setMapError(null);
      addSimulationLayers(map);
      setReady(true);
    });
    return () => {
      markerRef.current = null;
      mapRef.current = null;
      setReady(false);
      map.remove();
    };
  }, [webglAvailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selected) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const lngLat: [number, number] = [selected.longitude, selected.latitude];
    if (!markerRef.current) {
      markerRef.current = new Marker({ color: '#e8eef2', scale: 0.8 }).setLngLat(lngLat).addTo(map);
    } else {
      markerRef.current.setLngLat(lngLat);
    }
  }, [selected]);

  // Radar simulato: traiettoria, inquadratura e transizione animata fra i passi.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const radarSource = map.getSource<GeoJSONSource>(RADAR_SOURCE);
    const trackSource = map.getSource<GeoJSONSource>(TRACK_SOURCE);
    const hailSource = map.getSource<GeoJSONSource>(HAIL_SOURCE);
    const outflowSource = map.getSource<GeoJSONSource>(OUTFLOW_SOURCE);
    if (!radarSource || !trackSource || !hailSource || !outflowSource) return;

    if (!experiment) {
      shownExperimentRef.current = null;
      displayedRef.current = 0;
      for (const source of [radarSource, trackSource, hailSource, outflowSource]) source.setData(EMPTY);
      return;
    }

    if (shownExperimentRef.current !== experiment) {
      shownExperimentRef.current = experiment;
      displayedRef.current = 0;
      trackSource.setData(trackData(experiment));
      map.fitBounds(experimentBounds(experiment, severe), { padding: 48, maxZoom: 9.5, duration: prefersReducedMotion() ? 0 : 900 });
    }

    const from = displayedRef.current;
    const draw = (t: number) => {
      displayedRef.current = t;
      radarSource.setData(radarAt(experiment, t).geometry);
      hailSource.setData(severe?.hail.occurs ? hailGeometry(hailAt(severe.hail, t)) : EMPTY);
      outflowSource.setData(
        severe?.downburst.occurs ? outflowGeometry(outflowAt(severe.downburst, t), experiment.cellDirection) : EMPTY,
      );
    };
    if (minute <= from || prefersReducedMotion()) {
      draw(minute);
      return;
    }
    let frameId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / TWEEN_MS);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
      draw(from + (minute - from) * eased);
      if (progress < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [experiment, severe, minute, ready]);

  const selectCenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    onSelect({ latitude: center.lat, longitude: center.lng });
  };

  const stage = experiment?.frames.find((frame) => frame.minute === minute)?.stage ?? 'NONE';
  // Legenda: solo i fenomeni presenti sulla mappa in questo istante.
  const hailVisible = Boolean(severe?.hail.occurs && (severe.hail.frames.find((f) => f.minute === minute)?.coreRadius ?? 0) > 0);
  const outflowVisible = Boolean(
    severe?.downburst.occurs && (severe.downburst.frames.find((f) => f.minute === minute)?.outflowRadius ?? 0) > 0,
  );
  const radarVisible = (experiment?.frames.find((f) => f.minute === minute)?.reflectivity ?? 0) >= (RADAR_BANDS[0]?.dbz ?? 20);

  return (
    <div className={`map-frame map-frame--${mode}`}>
      <div
        ref={containerRef}
        className="map"
        role="application"
        aria-label="Mappa: fai clic su un punto per richiedere lo stato atmosferico reale. Con la tastiera usa le frecce per spostarti e + / - per lo zoom."
      />
      {mode === 'live' && <span className="map-crosshair" aria-hidden="true" />}
      {(mapError ?? !webglAvailable) && (
        <p className="map-error" role="status">
          {webglAvailable ? mapError : 'Mappa non disponibile: il browser non supporta WebGL.'}
        </p>
      )}

      {mode === 'live' ? (
        <div className="map-toolbar">
          <button type="button" className="button button--ghost" onClick={selectCenter}>
            Seleziona centro mappa
          </button>
        </div>
      ) : (
        <div className="map-sim-badge" role="note">
          <strong>RADAR SIMULATO</strong>
          <span>Simulazione didattica · non è una previsione</span>
          {experiment?.develops && (
            <span className="map-sim-badge__time">
              {formatOffset(minute)} · {STAGE_LABELS[stage]}
            </span>
          )}
        </div>
      )}

      {prompt && (
        <p className={`map-prompt map-prompt--${prompt}`} role="status">
          {PROMPTS[prompt]}
        </p>
      )}

      {experiment && !experiment.develops && (
        <p className="map-prompt map-prompt--none" role="status">
          NESSUNA CONVEZIONE SIGNIFICATIVA
        </p>
      )}

      {experiment?.develops && (radarVisible || hailVisible || outflowVisible) && (
        <div className="radar-legend" aria-label="Legenda dei fenomeni simulati presenti sulla mappa">
          {radarVisible && (
            <>
              <span className="radar-legend__title">SIM RADAR</span>
              <span className="radar-legend__scale" aria-hidden="true">
                {RADAR_BANDS.map((band) => (
                  <span key={band.key} style={{ background: band.color }} title={`${band.label} (≥ ${band.dbz} dBZ)`} />
                ))}
              </span>
              <span className="radar-legend__labels">
                <span>debole</span>
                <span>intenso</span>
              </span>
            </>
          )}
          {hailVisible && (
            <span className="radar-legend__item">
              <span className="radar-legend__hail" aria-hidden="true" />
              HAIL SIM · grandine simulata
            </span>
          )}
          {outflowVisible && (
            <span className="radar-legend__item">
              <span className="radar-legend__outflow" aria-hidden="true" />
              DOWNBURST OUTFLOW · fronte di raffica
            </span>
          )}
        </div>
      )}
    </div>
  );
}
