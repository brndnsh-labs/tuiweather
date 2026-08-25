import { resample, Sparkline } from "../../components/Sparkline";
import { formatHourLabel, type Units } from "../../lib/weather/format";
import type { HourlyPoint } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface HourlyStripProps {
  points: HourlyPoint[];
  nowUtc: string;
  utcOffsetSeconds: number;
  units: Units;
  maxPoints?: number;
  width: number;
  labels?: boolean;
}

const RAIN_RAMP = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const DRY_CHAR = "░";
const TEMP_LABEL = "temp ";
const RAIN_LABEL = "rain ";
const LABEL_GUTTER = TEMP_LABEL.length;
/** Widening beyond this many cells per point just smears the series into plateaus. */
const MAX_CELLS_PER_POINT = 3;

export function sliceUpcoming(points: HourlyPoint[], nowUtc: string, max: number): HourlyPoint[] {
  const nowMs = Date.parse(nowUtc);
  const upcoming = points.filter((p) => Date.parse(p.timeUtc) >= nowMs);
  return upcoming.slice(0, Math.max(0, max));
}

export function seriesWidthFor(pointCount: number, width: number): number {
  // One spare column: text sized to exactly the container width wraps its
  // last glyph onto an extra row in the char renderer.
  const maxWidth = Math.max(1, width - LABEL_GUTTER - 1);
  return Math.max(1, Math.min(pointCount * MAX_CELLS_PER_POINT, maxWidth));
}

export function precipBars(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  if (max <= 0) return DRY_CHAR.repeat(values.length);
  return values
    .map((v) => {
      if (v <= 0) return DRY_CHAR;
      const idx = Math.max(0, Math.min(7, Math.ceil((v / max) * 8) - 1));
      return RAIN_RAMP[idx] ?? RAIN_RAMP[0];
    })
    .join("");
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
): string {
  if (points.length === 0 || seriesWidth <= 0) return "";
  const chars = new Array<string>(seriesWidth).fill(" ");
  const step = Math.max(3, Math.floor(seriesWidth / 6));
  for (let c = 0; c < seriesWidth; c += step) {
    const idx = Math.min(points.length - 1, Math.floor(((c + 0.5) / seriesWidth) * points.length));
    const point = points[idx];
    if (!point) continue;
    const label = formatHourLabel(point.timeUtc, utcOffsetSeconds);
    for (let k = 0; k < label.length && c + k < seriesWidth; k++) {
      chars[c + k] = label[k] ?? " ";
    }
  }
  return `${" ".repeat(LABEL_GUTTER)}${chars.join("")}`;
}

export function HourlyStrip({
  points,
  nowUtc,
  utcOffsetSeconds,
  maxPoints = 24,
  width,
  labels = true,
}: HourlyStripProps) {
  const palette = usePalette();

  const window = sliceUpcoming(points, nowUtc, maxPoints);
  if (window.length === 0 || width < 6) return null;

  const seriesWidth = seriesWidthFor(window.length, width);
  const tempValues = window.map((p) => p.temperatureC);
  const precipValues = window.map((p) => p.precipMm);

  return (
    <box flexDirection="column">
      <text fg={palette.fgDim}>{sectionRule(`next ${window.length}h`, width)}</text>
      <box flexDirection="row">
        <text fg={palette.fgDim}>{TEMP_LABEL}</text>
        <Sparkline values={tempValues} width={seriesWidth} palette={palette} />
      </box>
      <box flexDirection="row">
        <text fg={palette.fgDim}>{RAIN_LABEL}</text>
        <text fg={palette.accent}>{precipBars(resample(precipValues, seriesWidth))}</text>
      </box>
      {labels ? (
        <text fg={palette.fgDim}>{hourLabelsRow(window, utcOffsetSeconds, seriesWidth)}</text>
      ) : null}
    </box>
  );
}
