import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Mappa MapLibre GL — vista iniziale sull'Italia.
 * Tile vettoriali OpenFreeMap (gratuite, senza chiave API, dati © OpenStreetMap).
 * La posizione dell'utente non viene mai richiesta.
 */
setWorkerUrl(workerUrl);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const ITALY_CENTER: [number, number] = [12.5, 42.1];
const ITALY_ZOOM = 4.8;

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface MapPoint {
  readonly latitude: number;
  readonly longitude: number;
}

interface MapViewProps {
  readonly selected: MapPoint | null;
  readonly onSelect: (point: MapPoint) => void;
  readonly mode: 'live' | 'sim';
}

export default function MapView({ selected, onSelect, mode }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const [webglAvailable] = useState(isWebGLAvailable);
  const [mapError, setMapError] = useState<string | null>(null);

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
    map.on('load', () => setMapError(null));
    return () => {
      markerRef.current = null;
      mapRef.current = null;
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
      markerRef.current = new Marker({ color: '#e8eef2' }).setLngLat(lngLat).addTo(map);
    } else {
      markerRef.current.setLngLat(lngLat);
    }
  }, [selected]);

  const selectCenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    onSelect({ latitude: center.lat, longitude: center.lng });
  };

  return (
    <div className={`map-frame map-frame--${mode}`}>
      <div
        ref={containerRef}
        className="map"
        role="application"
        aria-label="Mappa: fai clic su un punto per richiedere lo stato atmosferico reale. Con la tastiera usa le frecce per spostarti e + / - per lo zoom."
      />
      <span className="map-crosshair" aria-hidden="true" />
      {(mapError ?? !webglAvailable) && (
        <p className="map-error" role="status">
          {webglAvailable ? mapError : 'Mappa non disponibile: il browser non supporta WebGL.'}
        </p>
      )}
      <div className="map-toolbar">
        <button type="button" className="button button--ghost" onClick={selectCenter} disabled={mode === 'sim'}>
          Seleziona centro mappa
        </button>
      </div>
    </div>
  );
}
