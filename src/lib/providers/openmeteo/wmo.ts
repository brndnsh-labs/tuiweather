import type { Condition } from "../../weather/types";

export const WMO_TABLE: Readonly<Record<number, Condition>> = {
  0: "clear",
  1: "mostly-clear",
  2: "partly-cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "freezing-rain",
  57: "freezing-rain",
  61: "rain",
  63: "rain",
  65: "heavy-rain",
  66: "freezing-rain",
  67: "freezing-rain",
  71: "snow",
  73: "snow",
  75: "heavy-snow",
  77: "snow",
  80: "rain",
  81: "rain",
  82: "heavy-rain",
  85: "snow",
  86: "heavy-snow",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "hail",
};

const GLYPHS: Record<Condition, string> = {
  clear: "☀",
  "mostly-clear": "☀",
  "partly-cloudy": "🌤",
  overcast: "☁",
  fog: "🌫",
  drizzle: "🌦",
  rain: "🌧",
  "heavy-rain": "🌧",
  "freezing-rain": "🌨",
  snow: "❄",
  "heavy-snow": "🌨",
  sleet: "🌨",
  thunderstorm: "⛈",
  hail: "⛈",
};

const LABELS: Record<Condition, string> = {
  clear: "Clear sky",
  "mostly-clear": "Mostly clear",
  "partly-cloudy": "Partly cloudy",
  overcast: "Overcast",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  "heavy-rain": "Heavy rain",
  "freezing-rain": "Freezing rain",
  snow: "Snow",
  "heavy-snow": "Heavy snow",
  sleet: "Sleet",
  thunderstorm: "Thunderstorm",
  hail: "Hail",
};

export function wmoToCondition(code: number): Condition {
  return WMO_TABLE[code] ?? "overcast";
}

export function conditionGlyph(condition: Condition): string {
  return GLYPHS[condition];
}

export function conditionLabel(condition: Condition): string {
  return LABELS[condition];
}
