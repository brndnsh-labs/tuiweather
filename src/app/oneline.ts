import { conditionGlyph } from "../lib/providers/openmeteo/wmo";
import { deriveNowcast, type Nowcast } from "../lib/weather/derive";
import { formatTemp, formatWind, type Units } from "../lib/weather/format";
import type { Condition, NormalizedForecast } from "../lib/weather/types";

const SEPARATOR = " · ";

const ARROWS_8 = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"] as const;

function windArrow(directionDegFrom: number): string {
  const toDeg = (directionDegFrom + 180) % 360;
  const idx = Math.round(toDeg / 45) % 8;
  return ARROWS_8[idx] ?? "↑";
}

function windSegment(speedKmh: number, dirDeg: number, units: Units): string {
  const formatted = formatWind(speedKmh, dirDeg, units);
  const parts = formatted.split(" ");
  const speed = parts[0] ?? "";
  const unit = parts[1] ?? "";
  const compass = (parts[2] ?? "").toLowerCase();
  return `${windArrow(dirDeg)}${speed}${unit}${compass ? ` ${compass}` : ""}`;
}

function hiLoSegment(forecast: NormalizedForecast, units: Units): string {
  const today = forecast.daily[0];
  if (!today) return "";
  return `${formatTemp(today.tempMinC, units)}–${formatTemp(today.tempMaxC, units)}`;
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

export function buildOneLine(forecast: NormalizedForecast, units: Units, nowUtc: string): string {
  const current = forecast.current;
  const glyph = conditionGlyph(current.condition);
  const feelsLike = formatTemp(current.apparentC, units).replace("°", "");
  const segments = [
    `${glyph} ${formatTemp(current.temperatureC, units)} fl${feelsLike}`,
    nowcastSegment(forecast, nowUtc),
    hiLoSegment(forecast, units),
    windSegment(current.windSpeedKmh, current.windDirectionDeg, units),
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
  units: Units,
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
    line: buildOneLine(forecast, units, nowUtc),
  };
}
