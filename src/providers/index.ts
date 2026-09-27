import { OpenMeteoProvider } from './OpenMeteoProvider';
import type { WeatherProvider } from './WeatherProvider';

export const defaultProvider: WeatherProvider = new OpenMeteoProvider();
