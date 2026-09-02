import { memo } from "react";
import type { DisplayPrefs } from "../../lib/config/schema";
import type { ComfortWindow } from "../../lib/weather/derive";
import { HEADS_UP_GUST_KMH, TRACE_MM } from "../../lib/weather/derive";
import {
  formatHourRange,
  formatPrecip,
  formatTemp,
  formatWind,
  hourlyRainLabel,
  truncateCells,
  windComfortLabel,
} from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

/** Left column both lines share, so the `·`-joined fields line up. */
const LABEL_WIDTH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function padLabel(label: string): string {
  return label.padEnd(LABEL_WIDTH, " ");
}

/**
 * formatHourRange only knows hour-of-day, so a run spanning a full day or
 * more (e.g. a uniformly benign or uniformly hazardous 24h forecast — both
 * reachable, since a comfort window can legitimately be the whole lookahead)
 * would render a nonsensical same-hour range like "12–12 PM".
 */
function rangeLabel(window: ComfortWindow, utcOffsetSeconds: number, prefs: DisplayPrefs): string {
  const spanMs = Date.parse(window.endUtc) - Date.parse(window.startUtc);
  if (spanMs >= DAY_MS) return "all day";
  return formatHourRange(window.startUtc, window.endUtc, utcOffsetSeconds, prefs.timeFormat);
}

export function buildGoOutLine(
  window: ComfortWindow,
  utcOffsetSeconds: number,
  prefs: DisplayPrefs,
  width: number,
): string {
  const parts = [
    rangeLabel(window, utcOffsetSeconds, prefs),
    "dry",
    formatTemp(window.temperatureC, prefs.temp),
    windComfortLabel(window.windSpeedKmh),
  ];
  if (window.uvIndex !== null) parts.push(`uv ${Math.round(window.uvIndex)}`);
  return truncateCells(`${padLabel("go out")}${parts.join(" · ")}`, width);
}

export function buildHeadsUpLine(
  window: ComfortWindow,
  utcOffsetSeconds: number,
  prefs: DisplayPrefs,
  width: number,
): string {
  const isWet = window.precipMm >= TRACE_MM;
  const parts = [
    rangeLabel(window, utcOffsetSeconds, prefs),
    isWet ? hourlyRainLabel(window.precipMm) : "high wind",
  ];
  if (isWet) parts.push(`${formatPrecip(window.precipMm, prefs.precip)}/h`);
  if (window.windGustKmh !== null && window.windGustKmh >= HEADS_UP_GUST_KMH) {
    parts.push(`gusts ${formatWind(window.windGustKmh, null, prefs.wind)}`);
  }
  return truncateCells(`${padLabel("heads up")}${parts.join(" · ")}`, width);
}

interface ComfortLinesProps {
  goOut: ComfortWindow | null;
  headsUp: ComfortWindow | null;
  utcOffsetSeconds: number;
  prefs: DisplayPrefs;
  width: number;
}

export const ComfortLines = memo(function ComfortLines({
  goOut,
  headsUp,
  utcOffsetSeconds,
  prefs,
  width,
}: ComfortLinesProps) {
  const palette = usePalette();
  if (goOut === null && headsUp === null) return null;
  return (
    <>
      {goOut !== null ? (
        <text fg={palette.accent}>{buildGoOutLine(goOut, utcOffsetSeconds, prefs, width)}</text>
      ) : null}
      {headsUp !== null ? (
        <text fg={palette.warn}>{buildHeadsUpLine(headsUp, utcOffsetSeconds, prefs, width)}</text>
      ) : null}
    </>
  );
});
