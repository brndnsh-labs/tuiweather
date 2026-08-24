import type { Palette } from "../theme/palette";

export const SPARKLINE_RAMP = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

const EMPTY_CHAR = "–";
const FLAT_IDX = 3;

function resample(values: number[], width: number): number[] {
  if (width === values.length) return values;
  const out: number[] = [];
  for (let j = 0; j < width; j++) {
    const lo = Math.floor((j * values.length) / width);
    const hi = Math.max(lo + 1, Math.ceil(((j + 1) * values.length) / width));
    let sum = 0;
    let n = 0;
    for (let i = lo; i < Math.min(hi, values.length); i++) {
      const v = values[i];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    if (n === 0) {
      const fallback = values[Math.min(lo, values.length - 1)];
      out.push(fallback ?? 0);
    } else {
      out.push(sum / n);
    }
  }
  return out;
}

export function sparklineChars(values: number[], width?: number): string {
  if (values.length === 0) return EMPTY_CHAR;
  const w = Math.max(1, width ?? values.length);
  const pts = resample(values, w);
  let min = Infinity;
  let max = -Infinity;
  for (const v of pts) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  return pts
    .map((v) => {
      const idx =
        range === 0 ? FLAT_IDX : Math.max(0, Math.min(7, Math.round(((v - min) / range) * 8)));
      return SPARKLINE_RAMP[idx] ?? SPARKLINE_RAMP[0];
    })
    .join("");
}

interface SparklineProps {
  values: number[];
  width?: number;
  palette: Palette;
}

export function Sparkline({ values, width, palette }: SparklineProps) {
  return <text fg={palette.accent}>{sparklineChars(values, width)}</text>;
}
