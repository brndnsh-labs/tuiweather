import type { DisplayPrefs } from "../lib/config/schema";
import { conditionGlyph } from "../lib/weather/condition-display";
import { deriveNowcast, type Nowcast } from "../lib/weather/derive";
import { formatTemp, formatWind } from "../lib/weather/format";
import type { Condition, NormalizedForecast } from "../lib/weather/types";

const SEPARATOR = " · ";

const ARROWS_8 = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"] as const;

function windArrow(directionDegFrom: number): string {
  const toDeg = (directionDegFrom + 180) % 360;
  const idx = Math.round(toDeg / 45) % 8;
  return ARROWS_8[idx] ?? "↑";
}

function windSegment(speedKmh: number, dirDeg: number, wind: DisplayPrefs["wind"]): string {
  const formatted = formatWind(speedKmh, dirDeg, wind);
  const parts = formatted.split(" ");
  const speed = parts[0] ?? "";
  const unit = parts[1] ?? "";
  const compass = (parts[2] ?? "").toLowerCase();
  return `${windArrow(dirDeg)}${speed}${unit}${compass ? ` ${compass}` : ""}`;
}

function hiLoSegment(forecast: NormalizedForecast, temp: DisplayPrefs["temp"]): string {
  const today = forecast.daily[0];
  if (!today) return "";
  return `${formatTemp(today.tempMinC, temp)}–${formatTemp(today.tempMaxC, temp)}`;
}

function nowcastSegment(forecast: NormalizedForecast, nowUtc: string): string {
  const nowcast = deriveNowcast(forecast, nowUtc);
  switch (nowcast.kind) {
    case "dry":
      return "";
    case "starting":
      return `☂ in ${nowcast.startsInMin}min`;
    case "stopping":
      return `☂ ${nowcast.endsInMin}min`;
    case "ongoing":
      return nowcast.endsInMin === null ? "☂" : `☂ ${nowcast.endsInMin}min`;
  }
}

export function buildOneLine(
  forecast: NormalizedForecast,
  prefs: DisplayPrefs,
  nowUtc: string,
): string {
  const current = forecast.current;
  const glyph = conditionGlyph(current.condition);
  const feelsLike = formatTemp(current.apparentC, prefs.temp).replace("°", "");
  const segments = [
    `${glyph} ${formatTemp(current.temperatureC, prefs.temp)} fl${feelsLike}`,
    nowcastSegment(forecast, nowUtc),
    hiLoSegment(forecast, prefs.temp),
    windSegment(current.windSpeedKmh, current.windDirectionDeg, prefs.wind),
  ].filter((segment) => segment.length > 0);
  return segments.join(SEPARATOR);
}

export interface JsonLocation {
  label: string | null;
  latitude: number;
  longitude: number;
}

export interface OneLineJson {
  location: JsonLocation;
  observedAtUtc: string;
  temperatureC: number;
  apparentC: number;
  condition: Condition;
  nowcast: Nowcast;
  today: { minC: number | null; maxC: number | null };
  wind: { speedKmh: number; dirDeg: number; gustKmh: number | null };
  line: string;
}

export function buildJsonLine(
  forecast: NormalizedForecast,
  location: JsonLocation,
  prefs: DisplayPrefs,
  nowUtc: string,
): OneLineJson {
  const current = forecast.current;
  const today = forecast.daily[0];
  return {
    location,
    observedAtUtc: current.timeUtc,
    temperatureC: current.temperatureC,
    apparentC: current.apparentC,
    condition: current.condition,
    nowcast: deriveNowcast(forecast, nowUtc),
    today: today ? { minC: today.tempMinC, maxC: today.tempMaxC } : { minC: null, maxC: null },
    wind: {
      speedKmh: current.windSpeedKmh,
      dirDeg: current.windDirectionDeg,
      gustKmh: current.windGustKmh,
    },
    line: buildOneLine(forecast, prefs, nowUtc),
  };
}
