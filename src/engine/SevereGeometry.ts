import { clamp, lerp } from './physics';
import { offsetPoint, type GeoPoint } from './ConvectiveEngine';
import type { DownburstOutlook, DownburstStage } from './DownburstEngine';
import type { HailOutlook, HailStage } from './HailEngine';

/**
 * Geometrie sulla mappa di GRANDINE SIMULATA e DOWNBURST SIMULATO, generate in modo
 * deterministico dagli esiti di HailEngine e DownburstEngine (anche a minuti frazionari,
 * per l'animazione). Nessun dato reale.
 */

type Position = [number, number];

export interface SevereFeature {
  readonly type: 'Feature';
  readonly properties: Record<string, string | number>;
  readonly geometry:
    | { readonly type: 'Polygon'; readonly coordinates: Position[][] }
    | { readonly type: 'LineString'; readonly coordinates: Position[] }
    | { readonly type: 'Point'; readonly coordinates: Position };
}

export interface SevereCollection {
  readonly type: 'FeatureCollection';
  readonly features: SevereFeature[];
}

const EMPTY = (): SevereCollection => ({ type: 'FeatureCollection', features: [] });
const pos = (p: GeoPoint): Position => [Math.round(p.longitude * 1e6) / 1e6, Math.round(p.latitude * 1e6) / 1e6];

function interpolate<T extends { minute: number }>(frames: readonly T[], minute: number): [T, T, number] | null {
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) return null;
  const t = clamp(minute, first.minute, last.minute);
  let index = frames.findIndex((frame) => frame.minute > t) - 1;
  if (index < 0) index = frames.length - 1;
  const a = frames[index] ?? last;
  const b = frames[index + 1] ?? a;
  return [a, b, b.minute === a.minute ? 0 : (t - a.minute) / (b.minute - a.minute)];
}

export interface HailSnapshot {
  readonly stage: HailStage;
  readonly coreRadius: number;
  readonly center: GeoPoint;
}

export function hailAt(hail: HailOutlook, minute: number): HailSnapshot {
  const found = interpolate(hail.frames, minute);
  if (!found) return { stage: 'NONE', coreRadius: 0, center: { latitude: 0, longitude: 0 } };
  const [a, b, f] = found;
  return {
    stage: f < 0.5 ? a.stage : b.stage,
    coreRadius: lerp(a.coreRadius, b.coreRadius, f),
    center: { latitude: lerp(a.center.latitude, b.center.latitude, f), longitude: lerp(a.center.longitude, b.center.longitude, f) },
  };
}

/** Nucleo grandinigeno: contorno sobrio + "chicchi" in posizioni fisse + etichetta. */
export function hailGeometry(snapshot: HailSnapshot): SevereCollection {
  const collection = EMPTY();
  if (snapshot.coreRadius < 0.3) return collection;
  const ring: Position[] = [];
  for (let i = 0; i <= 48; i++) {
    const angle = (i / 48) * 360;
    const wobble = 1 + 0.08 * Math.sin((angle * Math.PI) / 60) + 0.05 * Math.cos((angle * Math.PI) / 36);
    ring.push(pos(offsetPoint(snapshot.center, angle, snapshot.coreRadius * wobble)));
  }
  collection.features.push({ type: 'Feature', properties: { kind: 'core', stage: snapshot.stage }, geometry: { type: 'Polygon', coordinates: [ring] } });
  // Chicchi: 9 posizioni deterministiche (spirale di Fibonacci) dentro il nucleo.
  for (let i = 0; i < 9; i++) {
    const r = snapshot.coreRadius * 0.85 * Math.sqrt((i + 0.5) / 9);
    collection.features.push({
      type: 'Feature',
      properties: { kind: 'stone' },
      geometry: { type: 'Point', coordinates: pos(offsetPoint(snapshot.center, (i * 137.508) % 360, r)) },
    });
  }
  collection.features.push({
    type: 'Feature',
    properties: { kind: 'label', label: 'GRANDINE SIMULATA' },
    geometry: { type: 'Point', coordinates: pos(offsetPoint(snapshot.center, 90, snapshot.coreRadius * 1.1)) },
  });
  return collection;
}

export interface OutflowSnapshot {
  readonly stage: DownburstStage;
  readonly radius: number;
  readonly center: GeoPoint;
  /** 0…1 — attenuazione in dissipazione. */
  readonly strength: number;
}

export function outflowAt(downburst: DownburstOutlook, minute: number): OutflowSnapshot {
  const found = interpolate(downburst.frames, minute);
  if (!found) return { stage: 'NONE', radius: 0, center: { latitude: 0, longitude: 0 }, strength: 0 };
  const [a, b, f] = found;
  const stage = f < 0.5 ? a.stage : b.stage;
  // Prima dell'impatto il fronte non esiste; dopo la fine della cella scompare.
  const radius = b.outflowRadius === 0 && a.outflowRadius > 0 ? a.outflowRadius * (1 - f) : lerp(a.outflowRadius, b.outflowRadius, f);
  const fade = (s: DownburstStage) => (s === 'DISSIPATING' ? 0.45 : s === 'NONE' ? 0 : 1);
  return { stage, radius, center: a.impactPoint, strength: lerp(fade(a.stage), fade(b.stage), f) };
}

/** Fronte di raffica: anello asimmetrico (più esteso nel verso del moto) e frecce verso l'esterno. */
export function outflowGeometry(snapshot: OutflowSnapshot, motionDirection: number): SevereCollection {
  const collection = EMPTY();
  if (snapshot.radius < 0.2 || snapshot.strength <= 0) return collection;
  const radiusAt = (angle: number) => snapshot.radius * (1 + 0.3 * Math.cos(((angle - motionDirection) * Math.PI) / 180));
  const ring: Position[] = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 360;
    ring.push(pos(offsetPoint(snapshot.center, angle, radiusAt(angle))));
  }
  const strength = Math.round(snapshot.strength * 100) / 100;
  collection.features.push({ type: 'Feature', properties: { kind: 'area', strength }, geometry: { type: 'Polygon', coordinates: [ring] } });
  collection.features.push({ type: 'Feature', properties: { kind: 'front', strength }, geometry: { type: 'LineString', coordinates: ring } });
  const arrow = Math.max(0.6, Math.min(3, snapshot.radius * 0.25));
  for (let i = 0; i < 8; i++) {
    const angle = i * 45;
    const r = radiusAt(angle);
    const tail = offsetPoint(snapshot.center, angle, Math.max(r - arrow * 1.6, r * 0.55));
    const tip = offsetPoint(snapshot.center, angle, r + arrow * 0.2);
    const left = offsetPoint(tip, angle + 150, arrow * 0.55);
    const right = offsetPoint(tip, angle - 150, arrow * 0.55);
    collection.features.push({ type: 'Feature', properties: { kind: 'arrow', strength }, geometry: { type: 'LineString', coordinates: [pos(tail), pos(tip)] } });
    collection.features.push({ type: 'Feature', properties: { kind: 'arrow', strength }, geometry: { type: 'LineString', coordinates: [pos(left), pos(tip), pos(right)] } });
  }
  collection.features.push({ type: 'Feature', properties: { kind: 'impact', strength }, geometry: { type: 'Point', coordinates: pos(snapshot.center) } });
  collection.features.push({
    type: 'Feature',
    properties: { kind: 'label', label: 'DOWNBURST SIMULATO', strength },
    geometry: { type: 'Point', coordinates: pos(offsetPoint(snapshot.center, (motionDirection + 180) % 360, radiusAt((motionDirection + 180) % 360) + 1)) },
  });
  return collection;
}
