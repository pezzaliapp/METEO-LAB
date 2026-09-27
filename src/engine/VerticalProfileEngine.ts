import { usableLevels, type AtmosphericProfile } from '../models/AtmosphericProfile';
import { clamp, dewPointFrom, lerp, relativeHumidityFrom } from './physics';

/**
 * VerticalProfileEngine — diagnostica del PROFILO ATMOSFERICO (Open-Meteo, modellistico).
 *
 * Lavora in quota SOPRA IL SUOLO (AGL): altezza geopotenziale − elevazione del punto.
 * I livelli sotto il terreno (estrapolati dal provider) sono esclusi.
 *
 * Due colonne:
 *  - AMBIENTE: suolo con i valori REALI osservati + livelli del profilo. È l'aria in cui
 *    sale la particella (ConvectiveEngine).
 *  - ESPERIMENTO: suolo con i valori SIMULATI + gli stessi livelli. Serve per le grandezze
 *    che dipendono dallo strato vicino al suolo modificato dall'utente
 *    (gradiente 0–3 km, shear, secchezza sotto la base delle nubi).
 *
 * Formule e approssimazioni:
 *  - interpolazione lineare in quota fra livelli; vento interpolato per componenti u/v;
 *  - zero termico: prima quota, salendo dal suolo, in cui T scende a 0 °C; se il profilo non
 *    la contiene si usa lo zero termico del provider (freezing_level_height);
 *  - zero del bulbo umido (approssimato): stessa ricerca sulla temperatura di bulbo umido
 *    di Stull (2011, J. Appl. Meteor. Climatol.), formula empirica valida al livello del mare
 *    (5–99 %, −20…50 °C): in quota è un'approssimazione;
 *  - gradiente basso (0–3 km) e medio (700–500 hPa) in °C/km;
 *  - shear 0–6 km: modulo della differenza vettoriale fra vento a 6 km e vento al suolo (m/s);
 *  - secchezza media (700 e 500 hPa) e sotto la base delle nubi: scarto T − Td medio (°C);
 *  - base delle nubi: LCL con la regola di Espy (≈ 125 m per °C di scarto T − Td al suolo);
 *  - vento medio 0–6 km (campionato ogni 500 m): approssimazione del vento che trasporta la cella.
 */

export interface SurfaceAir {
  /** °C */
  readonly temperature: number;
  /** % */
  readonly relativeHumidity: number;
  /** km/h */
  readonly windSpeed: number;
  /** ° provenienza; null se ignota. */
  readonly windDirection: number | null;
}

export interface ColumnPoint {
  /** m sopra il suolo */
  readonly height: number;
  readonly pressure: number | null;
  readonly temperature: number;
  readonly dewPoint: number | null;
  /** km/h */
  readonly windSpeed: number | null;
  readonly windDirection: number | null;
}

export interface ProfileColumn {
  readonly elevation: number;
  /** Ordinati per quota crescente; il primo punto è il suolo (0 m). */
  readonly points: readonly ColumnPoint[];
}

export interface Wind {
  /** km/h */
  readonly speed: number;
  /** ° VERSO cui si muove l'aria. */
  readonly directionTo: number;
}

export interface VerticalDiagnostics {
  readonly available: true;
  /** m sopra il suolo */
  readonly freezingLevel: number | null;
  readonly freezingLevelSource: 'profile' | 'provider' | null;
  /** m sopra il suolo (approssimato) */
  readonly wetBulbZeroApprox: number | null;
  /** °C/km, 0–3 km, con il suolo SIMULATO */
  readonly lapseRateLow: number | null;
  /** °C/km, 700–500 hPa */
  readonly lapseRateMid: number | null;
  /** m/s, 0–6 km, con il vento al suolo SIMULATO */
  readonly deepLayerShear: number | null;
  /** °C: scarto T − Td medio a 700 e 500 hPa */
  readonly midLevelDryness: number | null;
  /** °C: scarto T − Td medio fra suolo (SIM) e base delle nubi */
  readonly subCloudDryness: number;
  /** m sopra il suolo (LCL, suolo SIMULATO) */
  readonly cloudBase: number;
  readonly temperature500: number | null;
  /** Quote (m AGL) delle isoterme −10 °C e −30 °C: la zona di crescita della grandine. */
  readonly isotherm10: number | null;
  readonly isotherm30: number | null;
  readonly meanWind: Wind | null;
  readonly environment: ProfileColumn;
}

export interface VerticalUnavailable {
  readonly available: false;
  readonly missing: readonly string[];
}

export type VerticalAnalysis = VerticalDiagnostics | VerticalUnavailable;

/** Livelli indispensabili per GRANDINE LAB e DOWNBURST LAB. */
const REQUIRED_LEVELS = [700, 500] as const;
const LCL_METRES_PER_DEGREE = 125;

/** Temperatura di bulbo umido (°C) — Stull (2011). */
export function wetBulbStull(temperature: number, relativeHumidity: number): number {
  const rh = clamp(relativeHumidity, 5, 99);
  const t = temperature;
  return (
    t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(t + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

function toVector(speed: number, from: number): [number, number] {
  const rad = (from * Math.PI) / 180;
  // Direzione di PROVENIENZA → vettore del moto.
  return [-speed * Math.sin(rad), -speed * Math.cos(rad)];
}

function fromVector(u: number, v: number): Wind {
  return { speed: Math.hypot(u, v), directionTo: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360 };
}

/** Colonna sopra il suolo: punto al suolo fornito + livelli del profilo sopra il terreno. */
export function buildColumn(profile: AtmosphericProfile, surface: SurfaceAir): ProfileColumn | null {
  const elevation = profile.elevation ?? 0;
  const levels = usableLevels(profile)
    .map(
      (level): ColumnPoint => ({
        height: (level.height ?? 0) - elevation,
        pressure: level.pressure,
        temperature: level.temperature ?? 0,
        dewPoint: level.dewPoint ?? (level.relativeHumidity !== null ? dewPointFrom(level.temperature ?? 0, level.relativeHumidity) : null),
        windSpeed: level.windSpeed,
        windDirection: level.windDirection,
      }),
    )
    .filter((point) => point.height > 10)
    .sort((a, b) => a.height - b.height);
  if (levels.length === 0) return null;
  const ground: ColumnPoint = {
    height: 0,
    pressure: profile.surfacePressure,
    temperature: surface.temperature,
    dewPoint: dewPointFrom(surface.temperature, surface.relativeHumidity),
    windSpeed: surface.windSpeed,
    windDirection: surface.windDirection,
  };
  return Object.freeze({ elevation, points: Object.freeze([ground, ...levels]) });
}

function bracket(column: ProfileColumn, height: number): [ColumnPoint, ColumnPoint, number] | null {
  const points = column.points;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b && height >= a.height && height <= b.height) {
      return [a, b, b.height === a.height ? 0 : (height - a.height) / (b.height - a.height)];
    }
  }
  return null;
}

/** Temperatura interpolata; oltre l'ultimo livello null. */
export function temperatureAt(column: ProfileColumn, height: number): number | null {
  const found = bracket(column, height);
  return found ? lerp(found[0].temperature, found[1].temperature, found[2]) : null;
}

export function dewPointAt(column: ProfileColumn, height: number): number | null {
  const found = bracket(column, height);
  if (!found || found[0].dewPoint === null || found[1].dewPoint === null) return null;
  return lerp(found[0].dewPoint, found[1].dewPoint, found[2]);
}

export function windAt(column: ProfileColumn, height: number): Wind | null {
  const found = bracket(column, height);
  if (!found) return null;
  const [a, b, f] = found;
  if (a.windSpeed === null || a.windDirection === null || b.windSpeed === null || b.windDirection === null) return null;
  const [ua, va] = toVector(a.windSpeed, a.windDirection);
  const [ub, vb] = toVector(b.windSpeed, b.windDirection);
  return fromVector(lerp(ua, ub, f), lerp(va, vb, f));
}

/** Prima quota (salendo dal suolo) in cui la grandezza scende sotto la soglia. */
function crossingHeight(column: ProfileColumn, value: (p: ColumnPoint) => number | null, threshold: number): number | null {
  const points = column.points;
  const first = points[0];
  if (!first) return null;
  const v0 = value(first);
  if (v0 !== null && v0 <= threshold) return 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) continue;
    if (va > threshold && vb <= threshold) return a.height + ((va - threshold) / (va - vb)) * (b.height - a.height);
  }
  return null;
}

function wetBulbOf(point: ColumnPoint): number | null {
  if (point.dewPoint === null) return null;
  return wetBulbStull(point.temperature, relativeHumidityFrom(point.temperature, point.dewPoint));
}

export class VerticalProfileEngine {
  /** Colonna dell'AMBIENTE (suolo reale) per il ConvectiveEngine. */
  environmentColumn(profile: AtmosphericProfile | null, realSurface: SurfaceAir): ProfileColumn | null {
    return profile ? buildColumn(profile, realSurface) : null;
  }

  analyze(profile: AtmosphericProfile | null, realSurface: SurfaceAir, simSurface: SurfaceAir): VerticalAnalysis {
    if (!profile) return { available: false, missing: ['profilo verticale'] };
    const missing: string[] = [];
    for (const pressure of REQUIRED_LEVELS) {
      const level = profile.levels.find((item) => item.pressure === pressure);
      if (!level || !level.aboveGround) {
        missing.push(`${pressure} hPa`);
        continue;
      }
      for (const [key, label] of [
        ['height', 'quota'],
        ['temperature', 'temperatura'],
        ['dewPoint', 'punto di rugiada'],
        ['windSpeed', 'vento'],
        ['windDirection', 'direzione del vento'],
      ] as const) {
        if (level[key] === null) missing.push(`${label} a ${pressure} hPa`);
      }
    }
    const environment = buildColumn(profile, realSurface);
    const experiment = buildColumn(profile, simSurface);
    if (!environment || !experiment) missing.push('livelli sopra il suolo');
    if (missing.length > 0 || !environment || !experiment) return { available: false, missing };

    const elevation = environment.elevation;
    const level = (pressure: number) => experiment.points.find((point) => point.pressure === pressure) ?? null;
    const l700 = level(700);
    const l500 = level(500);

    let freezingLevel = crossingHeight(environment, (p) => p.temperature, 0);
    let freezingLevelSource: VerticalDiagnostics['freezingLevelSource'] = freezingLevel === null ? null : 'profile';
    if (freezingLevel === null && profile.freezingLevelHeight !== null) {
      freezingLevel = Math.max(0, profile.freezingLevelHeight - elevation);
      freezingLevelSource = 'provider';
    }

    const t3km = temperatureAt(experiment, 3000);
    const lapseRateLow = t3km === null ? null : (simSurface.temperature - t3km) / 3;
    const lapseRateMid =
      l700 && l500 && l500.height > l700.height ? ((l700.temperature - l500.temperature) / (l500.height - l700.height)) * 1000 : null;

    const surfaceWind = windAt(experiment, 0);
    const wind6 = windAt(experiment, 6000);
    let deepLayerShear: number | null = null;
    if (surfaceWind && wind6) {
      const [su, sv] = [surfaceWind.speed * Math.sin((surfaceWind.directionTo * Math.PI) / 180), surfaceWind.speed * Math.cos((surfaceWind.directionTo * Math.PI) / 180)];
      const [tu, tv] = [wind6.speed * Math.sin((wind6.directionTo * Math.PI) / 180), wind6.speed * Math.cos((wind6.directionTo * Math.PI) / 180)];
      deepLayerShear = Math.hypot(tu - su, tv - sv) / 3.6;
    }

    let u = 0;
    let v = 0;
    let samples = 0;
    for (let z = 0; z <= 6000; z += 500) {
      const wind = windAt(experiment, z);
      if (!wind) continue;
      u += wind.speed * Math.sin((wind.directionTo * Math.PI) / 180);
      v += wind.speed * Math.cos((wind.directionTo * Math.PI) / 180);
      samples++;
    }
    const meanWind = samples > 0 ? fromVector(u / samples, v / samples) : null;

    const depressions = [l700, l500].map((p) => (p && p.dewPoint !== null ? p.temperature - p.dewPoint : null));
    const midLevelDryness = depressions.every((d) => d !== null)
      ? depressions.reduce<number>((sum, d) => sum + (d ?? 0), 0) / depressions.length
      : null;

    const simDewPoint = dewPointFrom(simSurface.temperature, simSurface.relativeHumidity);
    const cloudBase = Math.max(0, LCL_METRES_PER_DEGREE * (simSurface.temperature - simDewPoint));
    let sum = 0;
    let count = 0;
    for (let z = 0; z <= cloudBase; z += 100) {
      const t = temperatureAt(experiment, z);
      const td = dewPointAt(experiment, z);
      if (t === null || td === null) continue;
      sum += t - td;
      count++;
    }
    const subCloudDryness = count > 0 ? sum / count : simSurface.temperature - simDewPoint;

    return Object.freeze({
      available: true,
      freezingLevel,
      freezingLevelSource,
      wetBulbZeroApprox: crossingHeight(environment, wetBulbOf, 0),
      lapseRateLow,
      lapseRateMid,
      deepLayerShear,
      midLevelDryness,
      subCloudDryness,
      cloudBase,
      temperature500: l500?.temperature ?? null,
      isotherm10: crossingHeight(environment, (p) => p.temperature, -10),
      isotherm30: crossingHeight(environment, (p) => p.temperature, -30),
      meanWind,
      environment,
    });
  }
}
