/**
 * Relazioni fisiche elementari usate dal simulatore didattico.
 */

// Coefficienti di Magnus (Alduchov & Eskridge, 1996), validi circa tra -40 °C e +50 °C.
const MAGNUS_A = 17.625;
const MAGNUS_B = 243.04;

/** Punto di rugiada (°C) da temperatura (°C) e umidità relativa (%). */
export function dewPointFrom(temperature: number, relativeHumidity: number): number {
  const rh = Math.min(Math.max(relativeHumidity, 1), 100);
  const gamma = Math.log(rh / 100) + (MAGNUS_A * temperature) / (MAGNUS_B + temperature);
  return (MAGNUS_B * gamma) / (MAGNUS_A - gamma);
}

/** Umidità relativa (%) da temperatura e punto di rugiada (°C). */
export function relativeHumidityFrom(temperature: number, dewPoint: number): number {
  const numerator = Math.exp((MAGNUS_A * dewPoint) / (MAGNUS_B + dewPoint));
  const denominator = Math.exp((MAGNUS_A * temperature) / (MAGNUS_B + temperature));
  return Math.min(100, Math.max(0, (100 * numerator) / denominator));
}

/**
 * Fattore di insolazione 0…1 in base all'ora solare locale approssimata
 * (UTC + longitudine / 15). Semplificazione didattica: giorno fra le 6 e le 18.
 */
export function solarFactor(dateUtc: Date, longitude: number): number {
  const utcHours = dateUtc.getUTCHours() + dateUtc.getUTCMinutes() / 60;
  const solarHour = (((utcHours + longitude / 15) % 24) + 24) % 24;
  if (solarHour <= 6 || solarHour >= 18) return 0;
  return Math.sin((Math.PI * (solarHour - 6)) / 12);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Tensione di vapore saturo (hPa) su acqua a temperatura T (°C) — Magnus, stessi coefficienti. */
export function saturationVaporPressure(temperature: number): number {
  return 6.1094 * Math.exp((MAGNUS_A * temperature) / (MAGNUS_B + temperature));
}

/** Rapporto di mescolanza di saturazione (kg/kg) a temperatura T (°C) e pressione p (hPa). */
export function saturationMixingRatio(temperature: number, pressure: number): number {
  const es = Math.min(saturationVaporPressure(temperature), pressure * 0.5);
  return (0.622 * es) / (pressure - es);
}

export function smoothstep(value: number, edge0: number, edge1: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
