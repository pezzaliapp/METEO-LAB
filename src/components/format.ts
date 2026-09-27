/** Formattazione dei valori per l'interfaccia (sempre con unità). */

export function formatValue(value: number | null | undefined, unit: string, decimals = 1): string {
  if (value === null || value === undefined) return '—';
  const text = value.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${text} ${unit}`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

export function formatDirection(degrees: number | null): string {
  if (degrees === null) return '—';
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return `${Math.round(degrees)}° ${COMPASS[index] ?? ''}`.trim();
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(3)}° ${longitude >= 0 ? 'E' : 'O'}`;
  return `${lat}, ${lon}`;
}

/** Descrizione sintetica del codice WMO (tabella usata da Open-Meteo). */
export function describeWeatherCode(code: number | null): string {
  if (code === null) return '—';
  if (code === 0) return 'Sereno';
  if (code <= 2) return 'Poco nuvoloso';
  if (code === 3) return 'Coperto';
  if (code === 45 || code === 48) return 'Nebbia';
  if (code >= 51 && code <= 57) return 'Pioviggine';
  if (code >= 61 && code <= 67) return 'Pioggia';
  if (code >= 71 && code <= 77) return 'Neve';
  if (code >= 80 && code <= 82) return 'Rovesci';
  if (code === 85 || code === 86) return 'Rovesci di neve';
  if (code >= 95) return 'Temporale';
  return `Codice WMO ${code}`;
}
