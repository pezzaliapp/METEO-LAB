import { offsetPoint, type CellFrame, type ConvectiveOutlook, type GeoPoint } from './ConvectiveEngine';

/** Elementi comuni a HailEngine e DownburstEngine. */

/** Un fattore fisico 0…1 con il valore che lo ha prodotto (per spiegare cause ed effetti). */
export interface PhysicalFactor {
  /** 0…1 — contributo favorevole nel modello didattico. */
  readonly score: number;
  /** Valore fisico da cui deriva (unità nel nome della chiave). */
  readonly value: number | null;
}

/** Posizione del nucleo di precipitazione: sul fronte della cella (come nel radar simulato). */
export function coreCenter(outlook: ConvectiveOutlook, frame: CellFrame): GeoPoint {
  return offsetPoint(frame.center, outlook.cellDirection, frame.radius * 0.2);
}

/** true se la cella raggiunge la fase matura. */
export function reachesMaturity(outlook: ConvectiveOutlook): boolean {
  return outlook.frames.some((frame) => frame.stage === 'MATURE');
}
