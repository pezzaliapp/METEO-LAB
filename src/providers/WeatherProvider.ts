import type { AtmosphericState } from '../models/AtmosphericState';

/**
 * WeatherProvider — sorgente astratta di stato atmosferico reale.
 *
 * v0.1.0: OpenMeteoProvider.
 * Futuri provider (radar, satellite, fulminazioni…) implementeranno la stessa interfaccia
 * o interfacce specifiche affiancate a questa.
 */
export interface WeatherProvider {
  readonly id: string;
  readonly name: string;
  readonly attribution: { readonly text: string; readonly url: string };
  getCurrentState(latitude: number, longitude: number, options?: RequestOptions): Promise<AtmosphericState>;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type WeatherProviderErrorKind =
  | 'offline'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'invalid-request'
  | 'invalid-response';

export class WeatherProviderError extends Error {
  readonly kind: WeatherProviderErrorKind;
  readonly status: number | null;

  constructor(kind: WeatherProviderErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'WeatherProviderError';
    this.kind = kind;
    this.status = status;
  }
}

/** Messaggio leggibile per l'interfaccia. */
export function describeProviderError(error: unknown): string {
  if (error instanceof WeatherProviderError) {
    switch (error.kind) {
      case 'offline':
        return 'Dispositivo offline: impossibile richiedere dati reali.';
      case 'timeout':
        return 'Il provider meteorologico non ha risposto in tempo.';
      case 'network':
        return 'Errore di rete durante la richiesta dei dati.';
      case 'aborted':
        return 'Richiesta annullata.';
      case 'http':
        return `Il provider ha risposto con un errore${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message}`;
      case 'invalid-request':
        return `Richiesta non valida: ${error.message}`;
      case 'invalid-response':
        return 'Risposta del provider non interpretabile.';
    }
  }
  return 'Errore imprevisto durante la richiesta dei dati.';
}
