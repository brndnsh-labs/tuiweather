import type {
  CurrentObs,
  DailyPoint,
  GeoPoint,
  HourlyPoint,
  NormalizedForecast,
} from "../../weather/types";
import type { ForecastWindow } from "../types";
import { nwsToCondition } from "./conditions";
import type {
  NwsObservationProperties,
  NwsPeriod,
  NwsPointsProperties,
  NwsQuantity,
} from "./schemas";

const PROVIDER_ID = "nws";
const MPH_TO_KMH = 1.609344;

export interface NwsResponses {
  points: NwsPointsProperties;
  hourly: NwsPeriod[];
  daily: NwsPeriod[];
  obs: NwsObservationProperties;
}

const COMPASS_DEGREES: Readonly<Record<string, number>> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

const OFFSET_PATTERN = /([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/;

function offsetSecondsFromIso(label: string): number {
  if (label.endsWith("Z")) return 0;
  const match = OFFSET_PATTERN.exec(label);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = match[4] === undefined ? 0 : Number(match[4]);
  return sign * (hours * 3600 + minutes * 60 + seconds);
}

function toIsoUtc(label: string): string {
  return new Date(Date.parse(label)).toISOString();
}

function fahrenheitToCelsius(value: number): number {
  return ((value - 32) * 5) / 9;
}

function periodTempC(period: NwsPeriod): number {
  return period.temperatureUnit.toUpperCase() === "F"
    ? fahrenheitToCelsius(period.temperature)
    : period.temperature;
}

const WIND_TEXT = /^(?:(\d+(?:\.\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?))?)\s*(mph|kt|km\/h|kmh)$/i;

function windSpeedTextToKmh(text: string): number {
  const match = WIND_TEXT.exec(text.trim());
  const loText = match?.[1];
  if (match === null || loText === undefined) return 0;
  const lo = Number(loText);
  const hi = match[2] === undefined ? lo : Number(match[2]);
  const unit = (match[3] ?? "").toLowerCase();
  const factor = unit === "mph" ? MPH_TO_KMH : unit === "kt" ? 1.852 : 1;
  return Math.max(lo, hi) * factor;
}

function compassToDegrees(text: string): number {
  return COMPASS_DEGREES[text.trim().toUpperCase()] ?? 0;
}

function quantityValue(q: NwsQuantity | undefined): number | null {
  return typeof q?.value === "number" ? q.value : null;
}

function maxNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return Math.max(...present);
}

function obsTempC(q: NwsQuantity | undefined): number | null {
  const value = quantityValue(q);
  if (value === null) return null;
  return (q?.unitCode ?? "").includes("degF") ? fahrenheitToCelsius(value) : value;
}

const WIND_UNIT_FACTORS: Readonly<Record<string, number>> = {
  "wmoUnit:km_h-1": 1,
  "wmoUnit:m_s-1": 3.6,
  "wmoUnit:kt": 1.852,
  "wmoUnit:mile_per_hour": MPH_TO_KMH,
};

function obsWindKmh(q: NwsQuantity | undefined): number | null {
  const value = quantityValue(q);
  if (value === null) return null;
  return value * (WIND_UNIT_FACTORS[q?.unitCode ?? ""] ?? 1);
}

function obsPressureHpa(q: NwsQuantity | undefined): number | null {
  const value = quantityValue(q);
  if (value === null) return null;
  return (q?.unitCode ?? "").includes("hPa") ? value : value / 100;
}

function obsVisibilityM(q: NwsQuantity | undefined): number | null {
  const value = quantityValue(q);
  if (value === null) return null;
  return (q?.unitCode ?? "").includes("km") ? value * 1000 : value;
}

function normalizeCurrent(obs: NwsObservationProperties): CurrentObs {
  const temperatureC = obsTempC(obs.temperature) ?? 0;
  const icon = obs.icon ?? "";
  return {
    timeUtc: toIsoUtc(obs.timestamp),
    temperatureC,
    apparentC: obsTempC(obs.heatIndex) ?? obsTempC(obs.windChill) ?? temperatureC,
    humidityPct: quantityValue(obs.relativeHumidity) ?? 0,
    condition: nwsToCondition(icon, obs.textDescription),
    windSpeedKmh: obsWindKmh(obs.windSpeed) ?? 0,
    windDirectionDeg: quantityValue(obs.windDirection) ?? 0,
    windGustKmh: obsWindKmh(obs.windGust),
    pressureHpa: obsPressureHpa(obs.seaLevelPressure) ?? obsPressureHpa(obs.barometricPressure),
    dewPointC: obsTempC(obs.dewpoint),
    visibilityM: obsVisibilityM(obs.visibility),
    uvIndex: null,
    isDay: !icon.includes("/night/"),
  };
}

function normalizeHourly(periods: NwsPeriod[], forecastHours: number | undefined): HourlyPoint[] {
  const limited = forecastHours === undefined ? periods : periods.slice(0, forecastHours);
  return limited.map((period) => {
    const temperatureC = periodTempC(period);
    return {
      timeUtc: toIsoUtc(period.endTime),
      temperatureC,
      apparentC: temperatureC,
      precipMm: 0,
      precipProbabilityPct: quantityValue(period.probabilityOfPrecipitation),
      condition: nwsToCondition(period.icon, period.shortForecast),
      windSpeedKmh: windSpeedTextToKmh(period.windSpeed),
      windGustKmh: null,
      windDirectionDeg: compassToDegrees(period.windDirection),
      humidityPct: quantityValue(period.relativeHumidity),
      uvIndex: null,
      visibilityM: null,
      isDay: period.isDaytime,
    };
  });
}

interface DaySegments {
  dateLocal: string;
  day: NwsPeriod | undefined;
  night: NwsPeriod | undefined;
}

function groupDayNightPeriods(periods: NwsPeriod[]): DaySegments[] {
  const byDate = new Map<string, DaySegments>();
  for (const period of periods) {
    const dateLocal = period.startTime.slice(0, 10);
    let entry = byDate.get(dateLocal);
    if (!entry) {
      entry = { dateLocal, day: undefined, night: undefined };
      byDate.set(dateLocal, entry);
    }
    if (period.isDaytime) {
      if (entry.day === undefined || period.temperature > entry.day.temperature) {
        entry.day = period;
      }
    } else if (entry.night === undefined || period.temperature < entry.night.temperature) {
      entry.night = period;
    }
  }
  return [...byDate.values()];
}

function normalizeDaily(periods: NwsPeriod[], forecastDays: number | undefined): DailyPoint[] {
  const groups = groupDayNightPeriods(periods);
  const limited = forecastDays === undefined ? groups : groups.slice(0, forecastDays);
  const daily: DailyPoint[] = [];
  for (const group of limited) {
    const primary = group.day ?? group.night;
    if (!primary) continue;
    const segments = [group.day, group.night].filter((p): p is NwsPeriod => p !== undefined);
    const tempsC = segments.map(periodTempC);
    const speeds = segments.map((p) => windSpeedTextToKmh(p.windSpeed));
    daily.push({
      dateLocal: group.dateLocal,
      condition: nwsToCondition(primary.icon, primary.shortForecast),
      tempMaxC: group.day ? periodTempC(group.day) : Math.max(...tempsC),
      tempMinC: group.night ? periodTempC(group.night) : Math.min(...tempsC),
      precipSumMm: 0,
      precipProbabilityMaxPct: maxNullable([
        quantityValue(group.day?.probabilityOfPrecipitation),
        quantityValue(group.night?.probabilityOfPrecipitation),
      ]),
      sunriseUtc: null,
      sunsetUtc: null,
      windSpeedMaxKmh: speeds.length > 0 ? Math.max(...speeds) : null,
    });
  }
  return daily;
}

export function normalizeNwsForecast(
  data: NwsResponses,
  location: GeoPoint,
  window?: ForecastWindow,
): NormalizedForecast {
  const firstLabeled = data.hourly[0] ?? data.daily[0];
  const utcOffsetSeconds = firstLabeled ? offsetSecondsFromIso(firstLabeled.startTime) : 0;
  return {
    providerId: PROVIDER_ID,
    location,
    timezone: data.points.timeZone,
    utcOffsetSeconds,
    fetchedAtUtc: new Date().toISOString(),
    current: normalizeCurrent(data.obs),
    hasMinutePrecip: false,
    minutely15: [],
    hourly: normalizeHourly(data.hourly, window?.forecastHours),
    daily: normalizeDaily(data.daily, window?.forecastDays),
  };
}
