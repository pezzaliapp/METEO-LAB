import type { AtmosphericProfile } from '../models/AtmosphericProfile';
import { ConvectiveEngine, type ConvectiveOutlook } from './ConvectiveEngine';
import { DownburstEngine, type DownburstOutlook } from './DownburstEngine';
import { HailEngine, type HailOutlook } from './HailEngine';
import { VerticalProfileEngine, buildColumn, type SurfaceAir, type VerticalAnalysis } from './VerticalProfileEngine';

/**
 * Esperimento completo di TEMPESTA LAB (v0.3):
 * PROFILO ATMOSFERICO → VerticalProfileEngine → ConvectiveEngine → HailEngine + DownburstEngine.
 * Funzione pura e deterministica; non modifica i dati reali ricevuti.
 */

export interface SevereOutlook {
  readonly vertical: VerticalAnalysis;
  readonly hail: HailOutlook;
  readonly downburst: DownburstOutlook;
}

export interface ExperimentInput {
  /** Aria al suolo REALE (osservazione). */
  readonly real: SurfaceAir;
  /** Aria al suolo SIMULATA (modificata dall'utente). */
  readonly sim: SurfaceAir;
  readonly profile: AtmosphericProfile | null;
  readonly surfacePressure: number | null;
  readonly latitude: number;
  readonly longitude: number;
}

const vertical = new VerticalProfileEngine();
const convective = new ConvectiveEngine();
const hail = new HailEngine();
const downburst = new DownburstEngine();

export function runExperiment(input: ExperimentInput): { convection: ConvectiveOutlook; severe: SevereOutlook } {
  const analysis = vertical.analyze(input.profile, input.real, input.sim);
  const surfacePressure = input.profile?.surfacePressure ?? input.surfacePressure;
  const convection = convective.evaluate({
    temperature: input.sim.temperature,
    relativeHumidity: input.sim.relativeHumidity,
    windSpeed: input.sim.windSpeed,
    windDirection: input.sim.windDirection,
    environmentTemperature: input.real.temperature,
    surfacePressure,
    latitude: input.latitude,
    longitude: input.longitude,
    environment: analysis.available ? analysis.environment : null,
    steeringWind: analysis.available ? analysis.meanWind : null,
    deepLayerShear: analysis.available ? analysis.deepLayerShear : null,
  });
  const experimentColumn = input.profile ? buildColumn(input.profile, input.sim) : null;
  return {
    convection,
    severe: Object.freeze({
      vertical: analysis,
      hail: hail.evaluate(convection, analysis),
      downburst: downburst.evaluate(convection, analysis, analysis.available ? experimentColumn : null, surfacePressure),
    }),
  };
}
