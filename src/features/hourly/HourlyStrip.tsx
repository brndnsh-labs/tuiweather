import { memo } from "react";
import { resample, SPARKLINE_RAMP } from "../../components/Sparkline";
import type { DisplayPrefs } from "../../lib/config/schema";
import { conditionGlyph } from "../../lib/weather/condition-display";
import {
  displayWidth,
  formatHourLabel,
  formatTemp,
  formatVisibility,
  type TimeFormat,
  truncateCells,
  type Units,
} from "../../lib/weather/format";
import type { Condition, HourlyPoint } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface HourlyStripProps {
  points: HourlyPoint[];
  nowUtc: string;
  utcOffsetSeconds: number;
  prefs: DisplayPrefs;
  maxPoints?: number;
  width: number;
  labels?: boolean;
  showDetail?: boolean;
}

const FULL_BLOCK = "█";
const BLANK = " ";
const TEMP_LABEL = "temp ";
const LABEL_GUTTER = TEMP_LABEL.length;
const BLANK_GUTTER = " ".repeat(LABEL_GUTTER);
/** Upscaling budgets: small windows stay at 2 cells/point, larger ones cap at 3 — beyond that the series smears into plateaus. */
const MAX_CELLS_PER_POINT = 3;
const COMPACT_CELLS_PER_POINT = 2;
const COMPACT_MAX_POINTS = 12;

const FROZEN_CONDITIONS: ReadonlySet<Condition> = new Set<Condition>([
  "snow",
  "heavy-snow",
  "sleet",
  "freezing-rain",
]);
const LIQUID_PRECIP_GLYPH = conditionGlyph("rain");
const FROZEN_PRECIP_GLYPH = conditionGlyph("snow");

export const TEMP_AREA_ROWS_WIDE = 4;
export const TEMP_AREA_ROWS_NARROW = 2;
/** Below this series width the chart drops to the narrow row count to stay legible. */
export const MIN_WIDE_AREA_SERIES_WIDTH = 20;
export const TRACE_MM = 0.05;
export const PROB_SUMMARY_PCT = 40;

/**
 * Absolute mm/h intensity ladder for hourly precip bars (documented contract,
 * encoded in tests): trace <0.05 blank, light <0.25 ▁▂, moderate <2.5 ▃▄▅,
 * heavy <10 ▆▇, extreme ≥10 █.
 */
export const PRECIP_MM_BUCKETS = [
  { belowMm: TRACE_MM, char: BLANK },
  { belowMm: 0.15, char: "▁" },
  { belowMm: 0.25, char: "▂" },
  { belowMm: 0.5, char: "▃" },
  { belowMm: 1, char: "▄" },
  { belowMm: 2.5, char: "▅" },
  { belowMm: 5, char: "▆" },
  { belowMm: 10, char: "▇" },
  { belowMm: Number.POSITIVE_INFINITY, char: FULL_BLOCK },
] as const;

export function precipBarChar(mm: number): string {
  for (const bucket of PRECIP_MM_BUCKETS) {
    if (mm < bucket.belowMm) return bucket.char;
  }
  return FULL_BLOCK;
}

export function precipBarsAbsolute(values: number[]): string {
  return values.map(precipBarChar).join("");
}

export function windowIsDry(precipMm: number[], probabilityPct: Array<number | null>): boolean {
  if (precipMm.some((mm) => mm >= TRACE_MM)) return false;
  return !probabilityPct.some((pct) => pct !== null && pct >= PROB_SUMMARY_PCT);
}

/**
 * Liquid vs frozen vs mixed for a window, judged only over wet points (mm at
 * or above trace): frozen needs at least half of them, mixed is any smaller
 * frozen share. No wet points falls back to liquid — the row is suppressed then.
 */
export function precipWindowKind(
  conditions: readonly Condition[],
  precipMm: readonly number[],
): { label: string; glyph: string } {
  const wet = conditions.filter((_, i) => (precipMm[i] ?? 0) >= TRACE_MM);
  const frozenCount = wet.filter((c) => FROZEN_CONDITIONS.has(c)).length;
  if (frozenCount === 0) return { label: "rain ", glyph: LIQUID_PRECIP_GLYPH };
  if (frozenCount * 2 >= wet.length) return { label: "snow ", glyph: FROZEN_PRECIP_GLYPH };
  return { label: "prec ", glyph: LIQUID_PRECIP_GLYPH };
}

/** Highest probability in the window, ties resolved to the earliest point; null under threshold. */
export function peakProbability(points: HourlyPoint[]): { pct: number; point: HourlyPoint } | null {
  let best: { pct: number; point: HourlyPoint } | null = null;
  for (const point of points) {
    const pct = point.precipProbabilityPct;
    if (pct === null) continue;
    if (best === null || pct > best.pct) best = { pct, point };
  }
  if (best === null || best.pct < PROB_SUMMARY_PCT) return null;
  return best;
}

export function sliceUpcoming(points: HourlyPoint[], nowUtc: string, max: number): HourlyPoint[] {
  const nowMs = Date.parse(nowUtc);
  const upcoming = points.filter((p) => Date.parse(p.timeUtc) > nowMs);
  return upcoming.slice(0, Math.max(0, max));
}

export function seriesWidthFor(pointCount: number, width: number): number {
  // One spare column: text sized to exactly the container width wraps its
  // last glyph onto an extra row in the char renderer.
  const maxWidth = Math.max(1, width - LABEL_GUTTER - 1);
  const cellsPerPoint =
    pointCount <= COMPACT_MAX_POINTS ? COMPACT_CELLS_PER_POINT : MAX_CELLS_PER_POINT;
  return Math.max(1, Math.min(pointCount * cellsPerPoint, maxWidth));
}

export function sectionRule(label: string, width: number): string {
  const prefix = `── ${label} `;
  if (width <= prefix.length) return prefix.slice(0, Math.max(0, width));
  return prefix + "─".repeat(width - prefix.length);
}

export function hourLabelsRow(
  points: HourlyPoint[],
  utcOffsetSeconds: number,
  seriesWidth: number,
  timeFormat: TimeFormat,
): string {
  if (points.length === 0 || seriesWidth <= 0) return "";
  const chars = new Array<string>(seriesWidth).fill(" ");
  const step = Math.max(3, Math.floor(seriesWidth / 6));
  for (let c = 0; c < seriesWidth; c += step) {
    const idx = Math.min(points.length - 1, Math.floor(((c + 0.5) / seriesWidth) * points.length));
    const point = points[idx];
    if (!point) continue;
    const label = formatHourLabel(point.timeUtc, utcOffsetSeconds, timeFormat);
    for (let k = 0; k < label.length && c + k < seriesWidth; k++) {
      chars[c + k] = label[k] ?? " ";
    }
  }
  return `${BLANK_GUTTER}${chars.join("")}`;
}

function areaRampChar(fraction: number): string {
  const idx = Math.min(SPARKLINE_RAMP.length - 1, Math.floor(fraction * SPARKLINE_RAMP.length));
  return SPARKLINE_RAMP[idx] ?? FULL_BLOCK;
}

/**
 * Multi-row area chart over resampled values normalized to the window min/max.
 * Row 0 is the top. Each column reads top-to-bottom as blanks above the curve,
 * one fractional ramp cell at the boundary, then full blocks below it.
 */
export function buildTempAreaRows(values: number[], rows: number, width: number): string[] {
  if (values.length === 0 || rows <= 0 || width <= 0) return [];
  const pts = resample(values, width);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of pts) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(width).fill(BLANK));
  for (let c = 0; c < width; c++) {
    const v = pts[c];
    if (v === undefined) continue;
    const height = (range === 0 ? 0.5 : (v - min) / range) * rows;
    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      if (!row) continue;
      const fraction = height - (rows - 1 - r);
      row[c] = fraction <= 0 ? BLANK : fraction >= 1 ? FULL_BLOCK : areaRampChar(fraction);
    }
  }
  return grid.map((row) => row.join(""));
}

function extremes(values: number[]): {
  hiIdx: number;
  hiVal: number;
  loIdx: number;
  loVal: number;
} {
  let hiIdx = 0;
  let loIdx = 0;
  let hiVal = Number.NEGATIVE_INFINITY;
  let loVal = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) continue;
    if (v > hiVal) {
      hiVal = v;
      hiIdx = i;
    }
    if (v < loVal) {
      loVal = v;
      loIdx = i;
    }
  }
  return { hiIdx, hiVal, loIdx, loVal };
}

export interface AreaNote {
  row: number;
  col: number;
  label: string;
}

/** Hi annotation on the top row at the peak column, lo on the bottom row at the trough. */
export function planTempNotes(seriesTemps: number[], rowCount: number, units: Units): AreaNote[] {
  if (seriesTemps.length === 0 || rowCount <= 0) return [];
  const { hiIdx, hiVal, loIdx, loVal } = extremes(seriesTemps);
  return [
    { row: 0, col: hiIdx, label: formatTemp(hiVal, units) },
    { row: rowCount - 1, col: loIdx, label: formatTemp(loVal, units) },
  ];
}

export function fitNotes(rows: readonly string[], notes: readonly AreaNote[]): AreaNote[] {
  return notes.filter((note) => {
    const row = rows[note.row];
    return (
      row !== undefined &&
      note.col >= 0 &&
      note.label.length > 0 &&
      note.col + note.label.length <= row.length
    );
  });
}

function overlayNote(row: string, note: AreaNote): string {
  return row.slice(0, note.col) + note.label + row.slice(note.col + note.label.length);
}

/** Overlays fitting notes onto their rows; overflowing notes are dropped, never wrapped. */
export function annotateRows(rows: readonly string[], notes: readonly AreaNote[]): string[] {
  const out = [...rows];
  for (const note of fitNotes(rows, notes)) {
    const row = out[note.row];
    if (row === undefined) continue;
    out[note.row] = overlayNote(row, note);
  }
  return out;
}

export interface RowSegment {
  text: string;
  dim: boolean;
}

export function hourlyDetailRow(points: HourlyPoint[], windUnits: Units, width: number): string {
  if (points.length === 0 || width <= 0) return "";
  const uvValues: number[] = [];
  const rhValues: number[] = [];
  const visValues: number[] = [];
  for (const p of points) {
    if (p.uvIndex !== null) uvValues.push(p.uvIndex);
    if (p.humidityPct !== null) rhValues.push(p.humidityPct);
    if (p.visibilityM !== null) visValues.push(p.visibilityM);
  }
  const segments: string[] = [];
  if (uvValues.length > 0) {
    const peak = Math.max(...uvValues);
    segments.push(`uv ${Math.round(peak)}`);
  }
  if (rhValues.length > 0) {
    const min = Math.min(...rhValues);
    const max = Math.max(...rhValues);
    const roundedMin = Math.round(min);
    const roundedMax = Math.round(max);
    if (roundedMin === roundedMax) segments.push(`rh ${roundedMin}%`);
    else segments.push(`rh ${roundedMin}–${roundedMax}%`);
  }
  if (visValues.length > 0) {
    const worst = Math.min(...visValues);
    segments.push(`vis ${formatVisibility(worst, windUnits)}`);
  }
  if (segments.length === 0) return "";
  const content = segments.join(" · ");
  const row = `${BLANK_GUTTER}${content}`;
  if (displayWidth(row) > Math.max(0, width - 1)) return truncateCells(row, Math.max(0, width - 1));
  return row;
}

/** Splits a finished row into runs so annotated spans can render dim beside accent fill. */
export function segmentRow(row: string, marks: readonly AreaNote[]): RowSegment[] {
  const segments: RowSegment[] = [];
  let pos = 0;
  for (const mark of [...marks].sort((a, b) => a.col - b.col)) {
    if (mark.col < pos || mark.label.length === 0) continue;
    if (mark.col > pos) segments.push({ text: row.slice(pos, mark.col), dim: false });
    segments.push({ text: row.slice(mark.col, mark.col + mark.label.length), dim: true });
    pos = mark.col + mark.label.length;
  }
  if (pos < row.length) segments.push({ text: row.slice(pos), dim: false });
  return segments;
}

export const HourlyStrip = memo(function HourlyStrip({
  points,
  nowUtc,
  utcOffsetSeconds,
  prefs,
  maxPoints = 24,
  width,
  labels = true,
  showDetail = false,
}: HourlyStripProps) {
  const palette = usePalette();

  const window = sliceUpcoming(points, nowUtc, maxPoints);
  if (window.length === 0 || width < 6) return null;

  const seriesWidth = seriesWidthFor(window.length, width);
  const tempValues = window.map((p) => p.temperatureC);
  const precipValues = window.map((p) => p.precipMm);
  const probabilities = window.map((p) => p.precipProbabilityPct);

  const rowCount =
    seriesWidth < MIN_WIDE_AREA_SERIES_WIDTH ? TEMP_AREA_ROWS_NARROW : TEMP_AREA_ROWS_WIDE;
  const fillRows = buildTempAreaRows(tempValues, rowCount, seriesWidth);
  if (fillRows.length === 0) return null;

  const seriesTemps = resample(tempValues, seriesWidth);
  const notes = planTempNotes(seriesTemps, rowCount, prefs.temp);
  const fitted = fitNotes(fillRows, notes);
  const drawnRows = annotateRows(fillRows, notes);

  const peak = peakProbability(window);
  const precipKind = precipWindowKind(
    window.map((p) => p.condition),
    precipValues,
  );
  const title = peak
    ? `next ${window.length}h · ${precipKind.glyph} ${Math.round(peak.pct)}% ${formatHourLabel(
        peak.point.timeUtc,
        utcOffsetSeconds,
        prefs.timeFormat,
      )}`
    : `next ${window.length}h`;

  const chartRows = drawnRows.map((row, r) => {
    let col = 0;
    return {
      id: `temp-row-${r}`,
      gutter: r === 0 ? TEMP_LABEL : BLANK_GUTTER,
      cells: segmentRow(
        row,
        fitted.filter((n) => n.row === r),
      ).map((seg) => {
        const cell = { ...seg, key: col };
        col += seg.text.length;
        return cell;
      }),
    };
  });

  const detailRow = showDetail ? hourlyDetailRow(window, prefs.wind, width) : "";

  return (
    <box flexDirection="column">
      <text fg={palette.fgDim}>{sectionRule(title, width)}</text>
      {chartRows.map(({ id, gutter, cells }) => (
        <box key={id} flexDirection="row">
          <text fg={palette.fgDim}>{gutter}</text>
          <text>
            {cells.map(({ key, text, dim }) => (
              <span key={key} fg={dim ? palette.fgDim : palette.accent}>
                {text}
              </span>
            ))}
          </text>
        </box>
      ))}
      {windowIsDry(precipValues, probabilities) ? null : (
        <box flexDirection="row">
          <text fg={palette.fgDim}>{precipKind.label}</text>
          <text fg={palette.rain}>{precipBarsAbsolute(resample(precipValues, seriesWidth))}</text>
        </box>
      )}
      {detailRow ? <text fg={palette.fgDim}>{detailRow}</text> : null}
      {labels ? (
        <text fg={palette.fgDim}>
          {hourLabelsRow(window, utcOffsetSeconds, seriesWidth, prefs.timeFormat)}
        </text>
      ) : null}
    </box>
  );
});
