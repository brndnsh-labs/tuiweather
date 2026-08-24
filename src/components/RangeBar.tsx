import type { Palette } from "../theme/palette";

const TRACK = "░";
const FILL = "█";
const MIN_BAR = 1;

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [255, 255, 255];
  return [r, g, b];
}

export function lerpHex(cold: string, warm: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(cold);
  const [r2, g2, b2] = hexToRgb(warm);
  const clamped = Math.max(0, Math.min(1, t));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * clamped);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function rangeBarSpan(
  lo: number,
  hi: number,
  weekMin: number,
  weekMax: number,
  width: number,
): { start: number; end: number } {
  const w = Math.max(1, Math.floor(width));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { start: 0, end: w };
  let low = lo;
  let high = hi;
  if (high < low) [low, high] = [high, low];
  const span = weekMax - weekMin;
  if (!Number.isFinite(span) || span <= 0) {
    return { start: 0, end: w };
  }
  const clamp01 = (x: number) => Math.max(weekMin, Math.min(weekMax, x));
  const start = Math.round(((clamp01(low) - weekMin) / span) * w);
  let end = Math.round(((clamp01(high) - weekMin) / span) * w);
  if (end <= start) end = Math.min(w, start + MIN_BAR);
  return {
    start: Math.max(0, Math.min(w, start)),
    end: Math.max(0, Math.min(w, end)),
  };
}

interface RangeBarProps {
  lo: number;
  hi: number;
  weekMin: number;
  weekMax: number;
  width: number;
  palette: Palette;
}

export function RangeBar({ lo, hi, weekMin, weekMax, width, palette }: RangeBarProps) {
  const { start, end } = rangeBarSpan(lo, hi, weekMin, weekMax, width);
  const midpoint = (lo + hi) / 2;
  const frac =
    weekMax > weekMin
      ? (Math.max(weekMin, Math.min(weekMax, midpoint)) - weekMin) / (weekMax - weekMin)
      : 0.5;
  const fillFg = lerpHex(palette.tempCold, palette.tempWarm, frac);
  const left = TRACK.repeat(start);
  const fill = FILL.repeat(Math.max(0, end - start));
  const right = TRACK.repeat(Math.max(0, width - end));
  return (
    <box flexDirection="row">
      {left ? <text fg={palette.fgDim}>{left}</text> : null}
      {fill ? <text fg={fillFg}>{fill}</text> : null}
      {right ? <text fg={palette.fgDim}>{right}</text> : null}
    </box>
  );
}
