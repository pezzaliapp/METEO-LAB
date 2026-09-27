import { TIMELINE_MINUTES } from '../simulation/timeline';
import { clamp, lerp, round, saturationMixingRatio, smoothstep } from './physics';

/**
 * ConvectiveEngine — modello DIDATTICO della convezione per TEMPESTA LAB.
 *
 * NON è un modello meteorologico operativo e NON produce previsioni.
 * Serve a mostrare, con relazioni fisiche note e dichiarate, perché una
 * certa combinazione di temperatura, umidità e vento favorisce o meno
 * lo sviluppo di un temporale. Nessun numero casuale: stesso input → stesso risultato.
 *
 * DATI DISPONIBILI E PROXY
 * L'osservazione reale contiene solo grandezze al suolo. Il profilo verticale
 * (radiosondaggio) NON è disponibile, quindi:
 *
 *  1. Ambiente in quota (proxy dichiarato): si ipotizza un profilo con il gradiente
 *     termico medio dell'Atmosfera Standard ICAO (6,5 °C/km) fino a 11 km,
 *     ancorato alla temperatura REALE al suolo. L'utente modifica solo lo strato
 *     vicino al suolo: l'aria in quota resta quella "reale".
 *  2. Particella: parte dal suolo con temperatura e umidità SIMULATE. Sale lungo
 *     l'adiabatica secca (g/cp ≈ 9,8 °C/km) fino alla saturazione (LCL), poi lungo
 *     la pseudo-adiabatica satura (AMS Glossary, "moist-adiabatic lapse rate").
 *  3. Dall'ascesa si ricavano gli indici classici calcolati sul profilo IPOTIZZATO:
 *       - "CAPE didattica" (J/kg): energia di galleggiamento fra LFC ed EL;
 *       - "CIN didattica" (J/kg): lavoro negativo sotto l'LFC;
 *       - Lifted Index a 500 hPa.
 *     NON sono CAPE/CIN reali: sono proxy calcolati su un'atmosfera ipotizzata.
 *     Correzione di temperatura virtuale e trascinamento (entrainment) sono omessi.
 *  4. Vento in quota (proxy): il vento a 10 m viene esteso al vento di
 *     "trasporto" (~1 km) con la legge di potenza del profilo di vento (esponente 1/7)
 *     e ruotato di 20° per l'attrito (spirale di Ekman: in quota il vento ruota in
 *     senso orario nell'emisfero nord, antiorario in quello sud). Lo stesso valore è
 *     usato come proxy del wind shear 0–6 km.
 *
 * DALLE GRANDEZZE AL TEMPORALE (riferimenti)
 *  - Classi di CAPE: < 300 J/kg debole/assente, 300–1000 marginale, 1000–2500
 *    moderata, > 2500 forte (classificazione diffusa, es. NOAA/NWS).
 *  - CIN: < 50 J/kg inibizione debole, 50–200 moderata, > 200 forte.
 *  - Velocità massima della corrente ascendente dalla teoria della particella
 *    w = √(2·CAPE), ridotta del 50 % per trascinamento e carico d'acqua.
 *  - Organizzazione con il wind shear 0–6 km: < 10 m/s celle singole ("pulse"),
 *    10–20 m/s multicelle, > 20 m/s celle organizzate e più longeve.
 *  - Numero di Richardson di bulk BRN = CAPE / (½·U²) (Weisman & Klemp, 1982):
 *    BRN < 10 → shear troppo forte rispetto al galleggiamento, la corrente
 *    ascendente viene inclinata e dispersa.
 *  - Ciclo di vita della cella ordinaria (Byers & Braham, Thunderstorm Project, 1949):
 *    stadio cumulo, maturo (15–30 min), dissipazione.
 *  - Riflettività radar → intensità di pioggia con la relazione di Marshall–Palmer
 *    Z = 200·R^1,6, limitata a 53 dBZ (soglia "hail cap" dei radar NEXRAD).
 */

export type LifecycleStage = 'NONE' | 'INITIATION' | 'DEVELOPING' | 'MATURE' | 'WEAKENING' | 'DISSIPATING';

/** Regime di organizzazione della convezione. */
export type Organization = 'none' | 'single' | 'multicell' | 'organized' | 'sheared';

/** Fattore principale che impedisce lo sviluppo (solo se la cella non nasce). */
export type LimitingFactor = 'dry' | 'stable' | 'inhibition';

export interface ConvectiveInput {
  /** Temperatura SIMULATA al suolo (°C). */
  readonly temperature: number;
  /** Umidità relativa SIMULATA al suolo (%). */
  readonly relativeHumidity: number;
  /** Vento SIMULATO a 10 m (km/h). */
  readonly windSpeed: number;
  /** Direzione di provenienza del vento (°), dall'osservazione reale; null se mancante. */
  readonly windDirection: number | null;
  /** Temperatura REALE al suolo (°C): ancora il profilo ambientale ipotizzato. */
  readonly environmentTemperature: number;
  /** Pressione al suolo (hPa); null se mancante. */
  readonly surfacePressure: number | null;
  readonly latitude: number;
  readonly longitude: number;
}

export interface ConvectiveDiagnostics {
  /** Punto di rugiada della particella (°C). */
  readonly dewPoint: number;
  /** Livello di condensazione (m dal suolo), null se non raggiunto entro il profilo. */
  readonly lclHeight: number | null;
  /** Livello di convezione libera (m), null se la particella non diventa mai più calda dell'ambiente. */
  readonly lfcHeight: number | null;
  /** Livello di equilibrio ≈ sommità della nube (m), null senza LFC. */
  readonly equilibriumHeight: number | null;
  /** CAPE calcolata sul profilo ipotizzato (J/kg) — proxy didattico. */
  readonly capeProxy: number;
  /** CIN calcolata sul profilo ipotizzato (J/kg, valore positivo) — proxy didattico. */
  readonly cinProxy: number;
  /** Lifted Index a 500 hPa (°C): negativo = instabile. */
  readonly liftedIndex: number | null;
  /** Corrente ascendente massima stimata (m/s). */
  readonly updraft: number;
  /** Proxy dello shear 0–6 km (m/s). */
  readonly shearProxy: number;
  /** Numero di Richardson di bulk; null con shear trascurabile. */
  readonly bulkRichardson: number | null;
}

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** Stato della cella a un minuto della timeline (o fra due minuti, se interpolato). */
export interface CellFrame {
  readonly minute: number;
  readonly stage: LifecycleStage;
  /** Riflettività massima (dBZ); 0 = nessun eco. */
  readonly reflectivity: number;
  /** Intensità di precipitazione sotto il nucleo (mm/h). */
  readonly precipitationIntensity: number;
  /** Raggio dell'eco (km). */
  readonly radius: number;
  readonly center: GeoPoint;
}

export interface ConvectiveOutlook {
  readonly input: ConvectiveInput;
  readonly diagnostics: ConvectiveDiagnostics;
  /** 0…1 — CAPE rispetto alla soglia di instabilità "forte", ridotta dall'inibizione. */
  readonly convectivePotential: number;
  /** 0…1 — probabilità INTERNA al modello didattico, non una probabilità di previsione. */
  readonly stormProbability: number;
  /** 0…1 — corrente ascendente rispetto a 40 m/s. */
  readonly stormIntensity: number;
  /** mm/h al picco. */
  readonly precipitationIntensity: number;
  /** km — raggio dell'eco alla maturità. */
  readonly cellRadius: number;
  /** ° — direzione VERSO cui si sposta la cella (0 = Nord). */
  readonly cellDirection: number;
  /** km/h */
  readonly cellSpeed: number;
  /** true se la direzione del vento mancava ed è stata ipotizzata. */
  readonly directionAssumed: boolean;
  readonly develops: boolean;
  readonly organization: Organization;
  readonly limitingFactor: LimitingFactor | null;
  /** Primo minuto con echi, null se la cella non nasce. */
  readonly onsetMinute: number | null;
  /** dBZ massimi raggiunti. */
  readonly peakReflectivity: number;
  readonly frames: readonly CellFrame[];
  /** Seme deterministico per la forma del radar simulato. */
  readonly seed: number;
}

/* ------------------------------------------------------------------------ */
/* Costanti fisiche e riferimenti                                            */
/* ------------------------------------------------------------------------ */

const G = 9.80665; // m/s²
const RD = 287.04; // J/(kg·K)
const CP = 1005.7; // J/(kg·K)
const LV = 2.501e6; // J/kg
const EPSILON = 0.622;
const KELVIN = 273.15;

/** Profilo ipotizzato: Atmosfera Standard ICAO. */
const STANDARD_LAPSE_RATE = 0.0065; // K/m
const TROPOPAUSE_HEIGHT = 11_000; // m
const PROFILE_TOP = 13_000; // m
const STEP = 25; // m
const STANDARD_PRESSURE = 1013.25; // hPa

/** Soglie di letteratura usate come centro delle transizioni. */
export const REFERENCE = {
  /** CAPE sotto cui la convezione è debole/assente (J/kg). */
  capeWeak: 300,
  /** CAPE fra moderata e forte (J/kg). */
  capeStrong: 2500,
  /** CAPE da cui una cella ordinaria ha una fase matura più lunga (J/kg). */
  capeModerate: 1000,
  /** CIN: inibizione debole / centro della transizione / forte (J/kg). */
  cinWeak: 50,
  cinModerate: 100,
  cinStrong: 200,
  /** Shear 0–6 km (m/s): celle singole / multicelle / organizzate. */
  shearMulticell: 10,
  shearOrganized: 20,
  /** BRN sotto cui lo shear disperde la corrente ascendente (Weisman & Klemp). */
  brnSheared: 10,
  /** Corrente ascendente di riferimento per intensità = 1 (m/s). */
  updraftReference: 40,
  /** Base delle nubi oltre cui l'aria è considerata "troppo secca" (m). */
  dryCloudBase: 2000,
} as const;

/** Vento a ~1 km dal vento a 10 m: legge di potenza, esponente 1/7. */
export const STEERING_FACTOR = (1000 / 10) ** (1 / 7);
/** Rotazione del vento in quota per attrito (°), verso orario nell'emisfero nord. */
export const FRICTION_TURNING = 20;
/** Direzione di provenienza ipotizzata se manca il dato (venti occidentali delle medie latitudini). */
export const ASSUMED_WIND_DIRECTION = 270;

/** Riflettività (dBZ) sotto cui il radar non mostra echi significativi. */
export const ECHO_FLOOR_DBZ = 15;
/** Soglia di rilevamento del primo eco (dBZ). */
export const ECHO_MIN_DBZ = 20;
const HAIL_CAP_DBZ = 53;
const DBZ_RANGE: readonly [number, number] = [25, 65];

/** Intensità e dimensione relative per stadio (fattori moltiplicativi del picco). */
const STAGE_SHAPE: Record<LifecycleStage, { readonly intensity: number; readonly radius: number }> = {
  NONE: { intensity: 0, radius: 0 },
  INITIATION: { intensity: 0.3, radius: 0.35 },
  DEVELOPING: { intensity: 0.7, radius: 0.7 },
  MATURE: { intensity: 1, radius: 1 },
  // In dissipazione la pioggia si allarga e si indebolisce (fase di sola corrente discendente).
  WEAKENING: { intensity: 0.6, radius: 1.1 },
  DISSIPATING: { intensity: 0.3, radius: 1.2 },
};

const KM_PER_DEGREE = 111.32;

/* ------------------------------------------------------------------------ */
/* Ascesa della particella                                                    */
/* ------------------------------------------------------------------------ */

/** Gradiente pseudo-adiabatico saturo (K/m) — AMS Glossary of Meteorology. */
export function moistAdiabaticLapseRate(temperatureC: number, pressure: number): number {
  const t = temperatureC + KELVIN;
  const r = saturationMixingRatio(temperatureC, pressure);
  return (G * (1 + (LV * r) / (RD * t))) / (CP + (LV * LV * r * EPSILON) / (RD * t * t));
}

function dewPointOf(temperature: number, relativeHumidity: number): number {
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(clamp(relativeHumidity, 1, 100) / 100) + (a * temperature) / (b + temperature);
  return (b * gamma) / (a - gamma);
}

function environmentTemperatureAt(surface: number, height: number): number {
  return surface - STANDARD_LAPSE_RATE * Math.min(height, TROPOPAUSE_HEIGHT);
}

/** Solleva la particella sul profilo ipotizzato e calcola gli indici didattici. */
export function liftParcel(input: ConvectiveInput): Omit<ConvectiveDiagnostics, 'updraft' | 'shearProxy' | 'bulkRichardson'> {
  const dewPoint = dewPointOf(input.temperature, input.relativeHumidity);
  let pressure = input.surfacePressure ?? STANDARD_PRESSURE;
  const mixingRatio = saturationMixingRatio(dewPoint, pressure);

  let parcel = input.temperature;
  let saturated = input.relativeHumidity >= 100;
  let lclHeight: number | null = saturated ? 0 : null;
  let lfcHeight: number | null = null;
  let equilibriumHeight: number | null = null;
  let cape = 0;
  let cin = 0;
  let liftedIndex: number | null = null;

  for (let z = 0; z < PROFILE_TOP; z += STEP) {
    const envLow = environmentTemperatureAt(input.environmentTemperature, z);
    const envHigh = environmentTemperatureAt(input.environmentTemperature, z + STEP);
    // Equazione ipsometrica sul passo.
    const nextPressure = pressure * Math.exp((-G * STEP) / (RD * ((envLow + envHigh) / 2 + KELVIN)));

    if (!saturated) {
      parcel -= (G / CP) * STEP;
      if (saturationMixingRatio(parcel, nextPressure) <= mixingRatio) {
        saturated = true;
        lclHeight = z + STEP;
      }
    } else {
      parcel -= moistAdiabaticLapseRate(parcel, pressure) * STEP;
    }
    pressure = nextPressure;

    const height = z + STEP;
    const buoyancy = (G * (parcel - envHigh)) / (envHigh + KELVIN);

    if (liftedIndex === null && pressure <= 500) liftedIndex = envHigh - parcel;

    if (lfcHeight === null) {
      // Il galleggiamento positivo conta solo dopo la condensazione: sotto l'LCL
      // guida al più termiche secche, non una nube convettiva.
      if (saturated && buoyancy > 0) {
        lfcHeight = height;
        cape += buoyancy * STEP;
      } else if (buoyancy < 0) {
        cin -= buoyancy * STEP;
      }
    } else if (equilibriumHeight === null) {
      if (buoyancy > 0) cape += buoyancy * STEP;
      else equilibriumHeight = height;
    }
  }
  if (lfcHeight !== null && equilibriumHeight === null) equilibriumHeight = PROFILE_TOP;

  return {
    dewPoint,
    lclHeight,
    lfcHeight,
    equilibriumHeight,
    capeProxy: cape,
    cinProxy: cin,
    liftedIndex,
  };
}

/* ------------------------------------------------------------------------ */
/* Movimento                                                                  */
/* ------------------------------------------------------------------------ */

export function steeringOf(input: ConvectiveInput): { speed: number; direction: number; assumed: boolean } {
  const assumed = input.windDirection === null;
  const from = input.windDirection ?? ASSUMED_WIND_DIRECTION;
  const turning = input.latitude >= 0 ? FRICTION_TURNING : -FRICTION_TURNING;
  const direction = (((from + 180 + turning) % 360) + 360) % 360;
  return { speed: input.windSpeed * STEERING_FACTOR, direction, assumed };
}

/** Punto a `distanceKm` dall'origine lungo `bearing` (° da Nord) — approssimazione locale piana. */
export function offsetPoint(origin: GeoPoint, bearing: number, distanceKm: number): GeoPoint {
  const rad = (bearing * Math.PI) / 180;
  const north = distanceKm * Math.cos(rad);
  const east = distanceKm * Math.sin(rad);
  const latitude = clamp(origin.latitude + north / KM_PER_DEGREE, -89.9, 89.9);
  const cosLat = Math.max(Math.cos((origin.latitude * Math.PI) / 180), 0.01);
  let longitude = origin.longitude + east / (KM_PER_DEGREE * cosLat);
  longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return { latitude, longitude };
}

/** Distanza (km) fra due punti vicini — stessa approssimazione di offsetPoint. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const cosLat = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180);
  const north = (b.latitude - a.latitude) * KM_PER_DEGREE;
  const east = (b.longitude - a.longitude) * KM_PER_DEGREE * cosLat;
  return Math.hypot(north, east);
}

/** Direzione (° da Nord) da a verso b. */
export function bearingBetween(a: GeoPoint, b: GeoPoint): number {
  const cosLat = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180);
  const north = b.latitude - a.latitude;
  const east = (b.longitude - a.longitude) * cosLat;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/* ------------------------------------------------------------------------ */
/* Motore                                                                     */
/* ------------------------------------------------------------------------ */

/** Intensità di pioggia (mm/h) dalla riflettività: Marshall–Palmer, con hail cap. */
export function rainRateFromReflectivity(dbz: number): number {
  if (dbz < ECHO_MIN_DBZ) return 0;
  const z = 10 ** (Math.min(dbz, HAIL_CAP_DBZ) / 10);
  return (z / 200) ** (1 / 1.6);
}

export class ConvectiveEngine {
  evaluate(input: ConvectiveInput): ConvectiveOutlook {
    const ascent = liftParcel(input);
    const steering = steeringOf(input);
    const shear = (steering.speed * 1000) / 3600; // km/h → m/s
    const cape = ascent.capeProxy;
    const cin = ascent.cinProxy;

    const updraft = 0.5 * Math.sqrt(2 * cape);
    const bulkRichardson = shear >= 1 ? cape / (0.5 * shear * shear) : null;
    const diagnostics: ConvectiveDiagnostics = {
      ...ascent,
      updraft,
      shearProxy: shear,
      bulkRichardson,
    };

    // Transizioni morbide centrate sulle soglie di letteratura (nessuna soglia a gradino nascosta).
    const capeFactor = smoothstep(cape, 0, 2 * REFERENCE.capeWeak);
    const inhibitionFactor = 1 - smoothstep(cin, 0, REFERENCE.cinStrong);
    const stormProbability = capeFactor * inhibitionFactor;
    const convectivePotential = clamp(cape / REFERENCE.capeStrong, 0, 1) * inhibitionFactor;
    // "Più probabile che no" nel modello didattico.
    const develops = stormProbability >= 0.5;
    const stormIntensity = develops ? clamp(updraft / REFERENCE.updraftReference, 0, 1) : 0;

    const organization = organizationOf(develops, shear, bulkRichardson);
    const limitingFactor = develops ? null : limitingFactorOf(ascent, capeFactor, inhibitionFactor);

    const peakReflectivity = develops ? lerp(DBZ_RANGE[0], DBZ_RANGE[1], stormIntensity) : 0;
    const baseRadius = 4 + 8 * stormIntensity;
    const cellRadius = develops ? baseRadius * (organization === 'multicell' || organization === 'organized' ? 1.3 : 1) : 0;

    const onsetMinute = develops ? (cin < REFERENCE.cinWeak ? 15 : 30) : null;
    const stages = scheduleStages(onsetMinute, organization, cape);
    const origin: GeoPoint = { latitude: input.latitude, longitude: input.longitude };

    const frames = TIMELINE_MINUTES.map((minute, index): CellFrame => {
      const stage = stages[index] ?? 'NONE';
      const growth = matureGrowth(stages, index, organization);
      const reflectivity =
        stage === 'NONE' ? 0 : round(ECHO_FLOOR_DBZ + (peakReflectivity - ECHO_FLOOR_DBZ) * STAGE_SHAPE[stage].intensity, 1);
      return Object.freeze({
        minute,
        stage,
        reflectivity,
        precipitationIntensity: round(rainRateFromReflectivity(reflectivity), 1),
        radius: round(cellRadius * STAGE_SHAPE[stage].radius * growth, 2),
        center: Object.freeze(offsetPoint(origin, steering.direction, (steering.speed * minute) / 60)),
      });
    });

    return Object.freeze({
      input: Object.freeze({ ...input }),
      diagnostics: Object.freeze(diagnostics),
      convectivePotential: round(convectivePotential, 3),
      stormProbability: round(stormProbability, 3),
      stormIntensity: round(stormIntensity, 3),
      precipitationIntensity: round(rainRateFromReflectivity(peakReflectivity), 1),
      cellRadius: round(cellRadius, 2),
      cellDirection: round(steering.direction, 1),
      cellSpeed: round(steering.speed, 1),
      directionAssumed: steering.assumed,
      develops,
      organization,
      limitingFactor,
      onsetMinute,
      peakReflectivity: round(peakReflectivity, 1),
      frames: Object.freeze(frames),
      seed: seedOf(input),
    });
  }

  /** Stadio a un minuto della timeline. */
  lifecycleStage(outlook: ConvectiveOutlook, minute: number): LifecycleStage {
    return outlook.frames.find((frame) => frame.minute === minute)?.stage ?? 'NONE';
  }
}

/**
 * Stato della cella a un istante qualsiasi fra T+0 e T+90 (anche frazionario):
 * interpolazione lineare fra i due passi vicini, usata per animare la mappa.
 */
export function cellAt(outlook: ConvectiveOutlook, minute: number): CellFrame {
  const frames = outlook.frames;
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) throw new Error('Timeline convettiva vuota');
  const t = clamp(minute, first.minute, last.minute);
  let index = frames.findIndex((frame) => frame.minute > t) - 1;
  if (index < 0) index = frames.length - 1;
  const a = frames[index] ?? last;
  const b = frames[index + 1] ?? a;
  const f = b.minute === a.minute ? 0 : (t - a.minute) / (b.minute - a.minute);
  const steering = { direction: outlook.cellDirection, speed: outlook.cellSpeed };
  const origin = { latitude: outlook.input.latitude, longitude: outlook.input.longitude };
  const reflectivity = lerp(a.reflectivity, b.reflectivity, f);
  // Una cella che nasce cresce dal centro; una cella che scompare si dissolve sul posto.
  const radius = a.stage === 'NONE' ? b.radius * f : b.stage === 'NONE' ? a.radius * (1 + 0.1 * f) : lerp(a.radius, b.radius, f);
  return {
    minute: t,
    stage: f < 0.5 ? a.stage : b.stage,
    reflectivity,
    precipitationIntensity: rainRateFromReflectivity(reflectivity),
    radius,
    center: offsetPoint(origin, steering.direction, (steering.speed * t) / 60),
  };
}

function organizationOf(develops: boolean, shear: number, brn: number | null): Organization {
  if (!develops) return 'none';
  if (brn !== null && brn < REFERENCE.brnSheared) return 'sheared';
  if (shear < REFERENCE.shearMulticell) return 'single';
  if (shear < REFERENCE.shearOrganized) return 'multicell';
  return 'organized';
}

function limitingFactorOf(
  ascent: ReturnType<typeof liftParcel>,
  capeFactor: number,
  inhibitionFactor: number,
): LimitingFactor {
  if (capeFactor >= 0.5 && inhibitionFactor < capeFactor) return 'inhibition';
  if (ascent.lclHeight === null || ascent.lclHeight > REFERENCE.dryCloudBase) return 'dry';
  return 'stable';
}

/**
 * Sequenza degli stadi (Byers & Braham): INITIATION → DEVELOPING → MATURE × n → WEAKENING → DISSIPATING.
 * La durata della fase matura dipende dall'organizzazione; con shear eccessivo la fase matura non viene raggiunta.
 */
function scheduleStages(onsetMinute: number | null, organization: Organization, cape: number): LifecycleStage[] {
  const stages: LifecycleStage[] = TIMELINE_MINUTES.map(() => 'NONE');
  if (onsetMinute === null) return stages;
  const matureSteps: Record<Organization, number> = {
    none: 0,
    sheared: 0,
    single: cape >= REFERENCE.capeModerate ? 2 : 1,
    multicell: 3,
    organized: 4,
  };
  const sequence: LifecycleStage[] = [
    'INITIATION',
    'DEVELOPING',
    ...Array.from({ length: matureSteps[organization] }, (): LifecycleStage => 'MATURE'),
    'WEAKENING',
    'DISSIPATING',
  ];
  const start = TIMELINE_MINUTES.indexOf(onsetMinute);
  sequence.forEach((stage, offset) => {
    if (start + offset < stages.length) stages[start + offset] = stage;
  });
  return stages;
}

/** Le multicelle si allargano durante la fase matura: nuove celle nascono sul fianco. */
function matureGrowth(stages: readonly LifecycleStage[], index: number, organization: Organization): number {
  if (organization !== 'multicell' && organization !== 'organized') return 1;
  let matureSoFar = 0;
  for (let i = 0; i <= index; i++) if (stages[i] === 'MATURE') matureSoFar++;
  return 1 + 0.12 * Math.max(0, matureSoFar - 1);
}

/** Seme deterministico (FNV-1a) dalle condizioni dell'esperimento. */
function seedOf(input: ConvectiveInput): number {
  const text = [
    input.temperature.toFixed(1),
    input.relativeHumidity.toFixed(0),
    input.windSpeed.toFixed(0),
    (input.windDirection ?? -1).toFixed(0),
    input.latitude.toFixed(3),
    input.longitude.toFixed(3),
  ].join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
