import { memo } from "react";
import {
  describeNowcast,
  type Nowcast,
  precipGlyph,
  upcomingPrecipBuckets,
  upcomingPrecipSeries,
  WET_MM,
} from "../../lib/weather/derive";
import { formatHourLabel, type TimeFormat } from "../../lib/weather/format";
import type { NormalizedForecast, PrecipInterval } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface NowcastBannerProps {
  nowcast: Nowcast;
  hideWhenDry?: boolean;
  width?: number;
  forecast?: NormalizedForecast;
  nowUtc?: string;
  expanded?: boolean;
  timeFormat?: TimeFormat;
}

function middleTruncate(text: string, width: number): string {
  if (text.length <= width) return text;
  const keep = Math.max(1, width - 1);
  const head = Math.floor(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

function stripFor(series: number[], width: number): string | null {
  const shown = series.slice(0, width);
  if (shown.length === 0 || !shown.some((mm) => mm >= WET_MM)) return null;
  return shown.map((mm) => precipGlyph(mm)).join("");
}

/** Sparse tick labels at hour boundaries (every ~4 buckets), keyed off each bucket's END instant per hard rule 3. */
function bucketLabelRow(
  buckets: PrecipInterval[],
  utcOffsetSeconds: number,
  timeFormat: TimeFormat,
): string {
  const chars = new Array<string>(buckets.length).fill(" ");
  buckets.forEach((bucket, i) => {
    const shifted = new Date(Date.parse(bucket.endUtc) + utcOffsetSeconds * 1000);
    if (shifted.getUTCMinutes() !== 0) return;
    const label = formatHourLabel(bucket.endUtc, utcOffsetSeconds, timeFormat);
    for (let k = 0; k < label.length && i + k < chars.length; k++) {
      chars[i + k] = label[k] ?? " ";
    }
  });
  return chars.join("");
}

function peakProbability(buckets: PrecipInterval[]): { col: number; label: string } | null {
  let peakIdx = -1;
  let peakPct = -1;
  buckets.forEach((bucket, i) => {
    if (bucket.probabilityPct !== null && bucket.probabilityPct > peakPct) {
      peakPct = bucket.probabilityPct;
      peakIdx = i;
    }
  });
  if (peakIdx === -1) return null;
  return { col: peakIdx, label: `${Math.round(peakPct)}%` };
}

function overlayAt(row: string, col: number, label: string): string {
  if (col < 0 || col + label.length > row.length) return row;
  return row.slice(0, col) + label + row.slice(col + label.length);
}

interface Expansion {
  barRow: string;
  labelRow: string;
}

/** Labeled 15-min precip bar for the toggled expansion — every bucket that fits `width`, peak probability overlaid on the bar. */
function buildExpansion(
  forecast: NormalizedForecast,
  nowUtc: string,
  width: number,
  timeFormat: TimeFormat,
): Expansion | null {
  const buckets = upcomingPrecipBuckets(forecast, nowUtc).slice(0, Math.max(0, width));
  if (buckets.length === 0) return null;
  const bar = buckets.map((b) => precipGlyph(b.precipMm)).join("");
  const peak = peakProbability(buckets);
  const barRow = peak ? overlayAt(bar, peak.col, peak.label) : bar;
  const labelRow = bucketLabelRow(buckets, forecast.utcOffsetSeconds, timeFormat);
  return { barRow, labelRow };
}

export const NowcastBanner = memo(function NowcastBanner({
  nowcast,
  hideWhenDry = false,
  width,
  forecast,
  nowUtc,
  expanded = false,
  timeFormat = "24h",
}: NowcastBannerProps) {
  const palette = usePalette();

  if (nowcast.kind === "unavailable") return null;

  const expansion =
    expanded && width !== undefined && forecast && nowUtc
      ? buildExpansion(forecast, nowUtc, width, timeFormat)
      : null;

  if (nowcast.kind === "dry") {
    if (hideWhenDry) return null;
    const sentence = middleTruncate(`▔ ${describeNowcast(nowcast)}`, width ?? 80);
    if (!expansion) return <text fg={palette.fgDim}>{sentence}</text>;
    return (
      <box flexDirection="column">
        <text fg={palette.fgDim}>{sentence}</text>
        <text fg={palette.fgDim}>{expansion.barRow}</text>
        <text fg={palette.fgDim}>{expansion.labelRow}</text>
      </box>
    );
  }

  const fg = nowcast.kind === "ongoing" ? palette.accent : palette.warn;
  const raw = `▔ ${describeNowcast(nowcast)}`;
  const sentence = width === undefined ? raw : middleTruncate(raw, width);

  const strip =
    width === undefined || !forecast || !nowUtc
      ? null
      : stripFor(upcomingPrecipSeries(forecast, nowUtc), width);

  if (!strip && !expansion) return <text fg={fg}>{sentence}</text>;

  return (
    <box flexDirection="column">
      <text fg={fg}>{sentence}</text>
      {strip ? <text fg={fg}>{strip}</text> : null}
      {expansion ? (
        <>
          <text fg={fg}>{expansion.barRow}</text>
          <text fg={fg}>{expansion.labelRow}</text>
        </>
      ) : null}
    </box>
  );
});
