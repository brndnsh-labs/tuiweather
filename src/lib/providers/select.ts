import { NWS_PROVIDER_ID, nwsProvider } from "./nws/client";
import { fetchAirQuality } from "./openmeteo/aq";
import { fetchForecast as fetchOpenMeteoForecast, OPENMETEO_PROVIDER_ID } from "./openmeteo/client";
import type { ProviderId, WeatherProvider } from "./types";

export type { ProviderId } from "./types";

const openmeteoProvider: WeatherProvider = {
  id: OPENMETEO_PROVIDER_ID,
  getForecast: (location, window) => fetchOpenMeteoForecast(location, window),
  getAirQuality: (location) => fetchAirQuality(location),
};

export function selectProvider(id: ProviderId): WeatherProvider {
  return id === NWS_PROVIDER_ID ? nwsProvider : openmeteoProvider;
}
