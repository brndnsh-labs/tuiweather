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

export function wmoToCondition(code: number): Condition {
  return WMO_TABLE[code] ?? "overcast";
}
