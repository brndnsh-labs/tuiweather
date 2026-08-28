import type { Condition } from "../../weather/types";

export const NWS_ICON_CODES: Readonly<Record<string, Condition>> = {
  skc: "clear",
  clr: "clear",
  few: "mostly-clear",
  sdw: "partly-cloudy",
  sct: "partly-cloudy",
  bkn: "overcast",
  ovc: "overcast",
  fg: "fog",
  fog: "fog",
  hvy_fog: "fog",
  dz: "drizzle",
  drizzle: "drizzle",
  ra: "rain",
  rain: "rain",
  showers: "rain",
  rain_showers: "rain",
  hi_showers: "rain",
  hvy_rain: "heavy-rain",
  heavy_rain: "heavy-rain",
  fzra: "freezing-rain",
  freezing_rain: "freezing-rain",
  fzdz: "freezing-rain",
  freezing_drizzle: "freezing-rain",
  sn: "snow",
  snow: "snow",
  flurries: "snow",
  snow_showers: "snow",
  hvy_sn: "heavy-snow",
  heavy_snow: "heavy-snow",
  blizzard: "heavy-snow",
  sle: "sleet",
  sleet: "sleet",
  rain_sleet: "sleet",
  tz: "thunderstorm",
  tsra: "thunderstorm",
  hi_tsra: "thunderstorm",
  nsw_tsra: "thunderstorm",
  hail: "hail",
};

const SEVERITY: Readonly<Record<Condition, number>> = {
  clear: 0,
  "mostly-clear": 1,
  "partly-cloudy": 2,
  overcast: 3,
  fog: 4,
  drizzle: 5,
  snow: 6,
  sleet: 7,
  rain: 8,
  "freezing-rain": 9,
  "heavy-rain": 10,
  "heavy-snow": 11,
  hail: 12,
  thunderstorm: 13,
};

const TEXT_RULES: ReadonlyArray<readonly [RegExp, Condition]> = [
  [/thunder/i, "thunderstorm"],
  [/hail/i, "hail"],
  [/blizzard|heavy snow/i, "heavy-snow"],
  [/freezing (rain|drizzle)/i, "freezing-rain"],
  [/sleet|wintry mix/i, "sleet"],
  [/snow|blowing snow/i, "snow"],
  [/heavy rain|downpour/i, "heavy-rain"],
  [/rain|shower/i, "rain"],
  [/drizzle/i, "drizzle"],
  [/fog|mist/i, "fog"],
  [/overcast|mostly cloudy|scattered clouds/i, "overcast"],
  [/partly/i, "partly-cloudy"],
  [/cloudy/i, "overcast"],
  [/mostly clear|mostly sunny/i, "mostly-clear"],
  [/clear|sunny|fair/i, "clear"],
];

function splitIconCodes(icon: string): string[] {
  const path = icon.split("?")[0] ?? "";
  const marker = /\/icons\/(?:land|zone)\/(?:day|night)\/(.+)$/.exec(path);
  const codes = marker?.[1];
  if (codes === undefined) return [];
  return codes
    .split("/")
    .flatMap((segment) => segment.split(","))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0 && Number.isNaN(Number(token)));
}

export function nwsIconToCondition(icon: string): Condition | undefined {
  let best: Condition | undefined;
  for (const token of splitIconCodes(icon)) {
    const condition = NWS_ICON_CODES[token];
    if (condition === undefined) continue;
    if (best === undefined || SEVERITY[condition] > SEVERITY[best]) best = condition;
  }
  return best;
}

export function nwsTextToCondition(text: string): Condition | undefined {
  for (const [pattern, condition] of TEXT_RULES) {
    if (pattern.test(text)) return condition;
  }
  return undefined;
}

export function nwsToCondition(icon: string, shortForecast: string): Condition {
  return nwsIconToCondition(icon) ?? nwsTextToCondition(shortForecast) ?? "overcast";
}
