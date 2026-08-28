export type Condition =
  | "clear"
  | "mostly-clear"
  | "partly-cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "freezing-rain"
  | "snow"
  | "heavy-snow"
  | "sleet"
  | "thunderstorm"
  | "hail";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface CurrentObs {
  timeUtc: string;
  temperatureC: number;
  apparentC: number;
  humidityPct: number;
  condition: Condition;
  windSpeedKmh: number;
  windDirectionDeg: number;
  windGustKmh: number | null;
  pressureHpa: number | null;
  cloudCoverPct: number | null;
  dewPointC: number | null;
  visibilityM: number | null;
  uvIndex: number | null;
  precipLast1hMm: number | null;
  isDay: boolean;
}

export interface PrecipInterval {
  startUtc: string;
  endUtc: string;
  /**
   * Sum over [startUtc, endUtc). Open-Meteo labels each minutely_15 bucket by
   * its END instant ("preceding 15 minutes sum"); normalize derives startUtc
   * as endUtc - 15min.
   */
  precipMm: number;
  probabilityPct: number | null;
}

export interface HourlyPoint {
  timeUtc: string;
  temperatureC: number;
  apparentC: number;
  /**
   * Sum over the preceding hour [timeUtc - 1h, timeUtc): Open-Meteo hourly
   * precipitation (and its probability, and wind gust max) is labeled by the
   * interval's END instant.
   */
  precipMm: number;
  precipProbabilityPct: number | null;
  condition: Condition;
  windSpeedKmh: number;
  windGustKmh: number | null;
  windDirectionDeg: number;
  humidityPct: number | null;
  uvIndex: number | null;
  visibilityM: number | null;
  isDay: boolean;
}

export interface DailyPoint {
  dateLocal: string;
  condition: Condition;
  tempMinC: number;
  tempMaxC: number;
  precipSumMm: number;
  precipProbabilityMaxPct: number | null;
  uvIndexMax: number | null;
  sunriseUtc: string | null;
  sunsetUtc: string | null;
  windSpeedMaxKmh: number | null;
  windGustMaxKmh: number | null;
}

export interface AirQuality {
  usAqi: number | null;
  pm25UgM3: number | null;
  ozoneUgM3: number | null;
  observedAtUtc: string;
}

export interface NormalizedForecast {
  providerId: string;
  location: GeoPoint;
  timezone: string;
  utcOffsetSeconds: number;
  fetchedAtUtc: string;
  current: CurrentObs;
  minutely15: PrecipInterval[];
  hourly: HourlyPoint[];
  daily: DailyPoint[];
}
