import { ECHO_FLOOR_DBZ, cellAt, offsetPoint, type CellFrame, type ConvectiveOutlook, type GeoPoint } from './ConvectiveEngine';

/**
 * SimulatedRadar — genera la geometria del RADAR SIMULATO di TEMPESTA LAB.
 *
 * Nessuna immagine radar reale: la cella è costruita proceduralmente e in modo
 * deterministico dallo stato del ConvectiveEngine.
 *
 *  - Campo di riflettività radiale: massimo nel nucleo, decresce verso il bordo
 *    dell'eco (15 dBZ) con legge di potenza; ogni soglia (20/35/45/55 dBZ) diventa
 *    un contorno chiuso, come nelle mappe radar a classi.
 *  - Forma irregolare: armoniche angolari con fasi derivate dal seme dell'esperimento
 *    (nessun numero casuale) che derivano lentamente nel tempo simulato.
 *  - Allungamento lungo la direzione di moto; nucleo spostato sul fronte della cella
 *    e pioggia debole che si estende nella parte posteriore.
 *  - Multicelle / celle organizzate: lobi sul fianco destro (emisfero nord) dove
 *    nascono nuove celle.
 */

export type RadarBandKey = 'light' | 'moderate' | 'heavy' | 'core';

export interface RadarBand {
  readonly key: RadarBandKey;
  /** Soglia inferiore (dBZ). */
  readonly dbz: number;
  readonly color: string;
  readonly label: string;
}

/** Scala radar meteorologica: verde → giallo → arancio → rosso. */
export const RADAR_BANDS: readonly RadarBand[] = [
  { key: 'light', dbz: 20, color: '#2fae4e', label: 'debole' },
  { key: 'moderate', dbz: 35, color: '#f1d33b', label: 'moderata' },
  { key: 'heavy', dbz: 45, color: '#f28c28', label: 'forte' },
  { key: 'core', dbz: 55, color: '#d9283a', label: 'nucleo intenso' },
];

/** Classe radar di una riflettività (null sotto la soglia del primo eco). */
export function bandOf(dbz: number): RadarBand | null {
  let result: RadarBand | null = null;
  for (const band of RADAR_BANDS) if (dbz >= band.dbz) result = band;
  return result;
}

type Position = [number, number];

export interface RadarFeature {
  readonly type: 'Feature';
  readonly properties: { readonly band: RadarBandKey; readonly dbz: number; readonly color: string; readonly order: number };
  readonly geometry: { readonly type: 'Polygon'; readonly coordinates: Position[][] };
}

export interface RadarFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: RadarFeature[];
}

const VERTICES = 96;
/** Esponente del profilo radiale di riflettività. */
const PROFILE_EXPONENT = 1.3;

/** Generatore pseudo-casuale deterministico (mulberry32) usato SOLO per derivare fasi dal seme. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Harmonic {
  readonly k: number;
  readonly amplitude: number;
  readonly phase: number;
  /** Deriva della fase (rad/min). */
  readonly drift: number;
}

function harmonicsFor(seed: number, salt: number, amplitude: number): Harmonic[] {
  const random = mulberry32(seed ^ Math.imul(salt + 1, 0x9e3779b1));
  return [2, 3, 4, 5, 7].map((k) => ({
    k,
    amplitude: (amplitude * (0.6 + 0.4 * random())) / k ** 0.7,
    phase: random() * Math.PI * 2,
    drift: (random() - 0.5) * 0.06,
  }));
}

function evaluateHarmonics(harmonics: readonly Harmonic[], angle: number, minute: number): number {
  let sum = 0;
  for (const h of harmonics) sum += h.amplitude * Math.sin(h.k * angle + h.phase + h.drift * minute);
  return sum;
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/**
 * Raggio (in frazione del raggio della cella) di ciascuna soglia:
 * dBZ(r) = picco − (picco − 15)·(r/R)^1,3  ⇒  r/R = ((picco − soglia)/(picco − 15))^(1/1,3).
 */
export function contourFraction(peak: number, threshold: number): number {
  if (peak <= threshold) return 0;
  return ((peak - threshold) / (peak - ECHO_FLOOR_DBZ)) ** (1 / PROFILE_EXPONENT);
}

/** Geometria radar per uno stato della cella. */
export function radarGeometry(frame: CellFrame, outlook: ConvectiveOutlook): RadarFeatureCollection {
  const features: RadarFeature[] = [];
  if (frame.radius <= 0 || frame.reflectivity < (RADAR_BANDS[0]?.dbz ?? 20)) return { type: 'FeatureCollection', features };

  const direction = (outlook.cellDirection * Math.PI) / 180;
  const weakening = frame.stage === 'WEAKENING' || frame.stage === 'DISSIPATING';
  // Eco allungato lungo il moto; in dissipazione la pioggia si stira ulteriormente.
  const aspect = 1.2 + (weakening ? 0.25 : 0) + Math.min(outlook.cellSpeed / 200, 0.25);
  const shared = harmonicsFor(outlook.seed, 0, 0.2);
  const flankSign = outlook.input.latitude >= 0 ? 1 : -1;
  const lobes: { angle: number; size: number }[] = [];
  if (outlook.organization === 'multicell' || outlook.organization === 'organized') {
    const growth = Math.min(1, frame.radius / Math.max(outlook.cellRadius, 0.1));
    lobes.push({ angle: direction + flankSign * 1.2, size: 0.6 * growth });
    if (outlook.organization === 'organized') lobes.push({ angle: direction + flankSign * 0.45, size: 0.45 * growth });
  }

  RADAR_BANDS.forEach((band, order) => {
    const fraction = contourFraction(frame.reflectivity, band.dbz);
    if (fraction <= 0) return;
    // Le classi più intense sono più irregolari: il nucleo non è una copia in scala del bordo.
    const own = harmonicsFor(outlook.seed, order + 1, 0.06 + 0.04 * order);
    // Nucleo spostato verso il fronte della cella, pioggia debole in coda.
    const shift = frame.radius * 0.28 * (1 - fraction);
    const center: GeoPoint = offsetPoint(frame.center, outlook.cellDirection, shift - frame.radius * 0.08);
    const ring: Position[] = [];
    for (let i = 0; i < VERTICES; i++) {
      const angle = (i / VERTICES) * Math.PI * 2;
      const relative = angle - direction;
      const ellipse = 1 / Math.sqrt((Math.cos(relative) / aspect) ** 2 + Math.sin(relative) ** 2);
      let shape = ellipse / Math.sqrt(aspect);
      shape *= 1 + evaluateHarmonics(shared, angle, frame.minute) + evaluateHarmonics(own, angle, frame.minute);
      for (const lobe of lobes) shape *= 1 + lobe.size * Math.exp(-((angularDistance(angle, lobe.angle) / 0.4) ** 2));
      const distance = Math.max(frame.radius * fraction * shape, 0.05);
      const point = offsetPoint(center, (angle * 180) / Math.PI, distance);
      ring.push([round6(point.longitude), round6(point.latitude)]);
    }
    const firstPoint = ring[0];
    if (firstPoint) ring.push([firstPoint[0], firstPoint[1]]);
    features.push({
      type: 'Feature',
      properties: { band: band.key, dbz: band.dbz, color: band.color, order },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  });
  return { type: 'FeatureCollection', features };
}

/** Radar simulato a un minuto qualsiasi (anche frazionario) dell'esperimento. */
export function radarAt(outlook: ConvectiveOutlook, minute: number): { frame: CellFrame; geometry: RadarFeatureCollection } {
  const frame = cellAt(outlook, minute);
  return { frame, geometry: radarGeometry(frame, outlook) };
}

/** Area (km²) di un anello — formula del poligono su proiezione locale piana. */
export function ringAreaKm2(ring: readonly Position[]): number {
  const first = ring[0];
  if (!first) return 0;
  const cosLat = Math.cos((first[1] * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!a || !b) continue;
    area += a[0] * cosLat * 111.32 * (b[1] * 111.32) - b[0] * cosLat * 111.32 * (a[1] * 111.32);
  }
  return Math.abs(area) / 2;
}

/** Baricentro approssimato (media dei vertici) di un anello. */
export function ringCentroid(ring: readonly Position[]): GeoPoint {
  const points = ring.slice(0, -1);
  const sum = points.reduce((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
  return { longitude: sum[0] / points.length, latitude: sum[1] / points.length };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
