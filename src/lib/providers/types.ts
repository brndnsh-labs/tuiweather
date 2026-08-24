import type { GeoPoint, NormalizedForecast } from "../weather/types";

export interface WeatherProvider {
  readonly id: string;
  getForecast(location: GeoPoint): Promise<NormalizedForecast>;
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
