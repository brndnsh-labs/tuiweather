import type { AirQuality, GeoPoint, NormalizedForecast } from "../weather/types";

export const PROVIDER_IDS = ["openmeteo", "nws"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
}

export interface ForecastWindow {
  forecastDays?: number;
  forecastHours?: number;
}

export interface WeatherProvider {
  readonly id: string;
  getForecast(location: GeoPoint, window?: ForecastWindow): Promise<NormalizedForecast>;
  getAirQuality?: (location: GeoPoint) => Promise<AirQuality>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
