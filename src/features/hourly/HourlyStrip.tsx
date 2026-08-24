import { Sparkline } from "../../components/Sparkline";
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

export function sliceUpcoming(points: HourlyPoint[], nowUtc: string, max: number): HourlyPoint[] {
  const nowMs = Date.parse(nowUtc);
  const upcoming = points.filter((p) => Date.parse(p.timeUtc) >= nowMs);
  return upcoming.slice(0, Math.max(0, max));
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

function hourLabelsRow(points: HourlyPoint[], utcOffsetSeconds: number, width: number): string {
  if (points.length === 0) return "";
  const step = Math.max(1, Math.ceil(points.length / 5));
  const cells = new Array<string>(points.length).fill(" ");
  for (let i = 0; i < points.length; i += step) {
    const point = points[i];
    if (!point) continue;
    const label = formatHourLabel(point.timeUtc, utcOffsetSeconds);
    cells[i] = label.slice(0, Math.min(step, width - i));
  }
  return cells.join("").slice(0, width);
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

  const seriesWidth = Math.min(window.length, Math.max(1, width - TEMP_LABEL.length));
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
        <text fg={palette.accent}>{precipBars(precipValues).slice(0, seriesWidth)}</text>
      </box>
      {labels ? (
        <text fg={palette.fgDim}>{hourLabelsRow(window, utcOffsetSeconds, width)}</text>
      ) : null}
    </box>
  );
}
