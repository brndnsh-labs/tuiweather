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
  "partly-cloudy": "☁",
  overcast: "☁",
  fog: "☰",
  drizzle: "☂",
  rain: "☂",
  "heavy-rain": "☂",
  "freezing-rain": "☂",
  snow: "❄",
  "heavy-snow": "❄",
  sleet: "❄",
  thunderstorm: "↯",
  hail: "▽",
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

export const CONDITION_ICON_CELLS = 2;

const ICONS: Record<Condition, string> = {
  clear: "\u2600\uFE0F",
  "mostly-clear": "\uD83C\uDF24\uFE0F",
  "partly-cloudy": "\u26C5\uFE0F",
  overcast: "\u2601\uFE0F",
  fog: "\uD83C\uDF2B\uFE0F",
  drizzle: "\uD83C\uDF26\uFE0F",
  rain: "\uD83C\uDF27\uFE0F",
  "heavy-rain": "\u2614\uFE0F",
  "freezing-rain": "\uD83C\uDF28\uFE0F",
  snow: "\u2744\uFE0F",
  "heavy-snow": "\u2603\uFE0F",
  sleet: "\u26C4\uFE0F",
  thunderstorm: "\uD83C\uDF29\uFE0F",
  hail: "\u26C8\uFE0F",
};

export function conditionIcon(condition: Condition): string {
  return ICONS[condition];
}

export function conditionLabel(condition: Condition): string {
  return LABELS[condition];
}
