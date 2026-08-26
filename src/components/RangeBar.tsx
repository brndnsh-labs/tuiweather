import type { Palette } from "../theme/palette";

export const PAD_GLYPH = "·";
export const FILL_GLYPH = "█";
const MIN_BAR = 1;
export const GRADIENT_STEPS = 8;

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

export interface BarSegment {
  text: string;
  fg: string;
}

function quantizedStep(temp: number, weekMin: number, weekMax: number): number {
  const span = weekMax - weekMin;
  if (!Number.isFinite(temp) || !Number.isFinite(span) || span <= 0) {
    return Math.round((GRADIENT_STEPS - 1) / 2);
  }
  const t = (Math.max(weekMin, Math.min(weekMax, temp)) - weekMin) / span;
  return Math.round(Math.max(0, Math.min(1, t)) * (GRADIENT_STEPS - 1));
}

export function rangeBarSegments(
  lo: number,
  hi: number,
  weekMin: number,
  weekMax: number,
  width: number,
  cold: string,
  warm: string,
  padFg: string,
): BarSegment[] {
  const w = Math.max(1, Math.floor(width));
  const { start, end } = rangeBarSpan(lo, hi, weekMin, weekMax, w);
  const segments: BarSegment[] = [];
  if (start > 0) segments.push({ text: PAD_GLYPH.repeat(start), fg: padFg });

  const fillLen = Math.max(0, end - start);
  if (fillLen > 0) {
    let low = lo;
    let high = hi;
    if (high < low) [low, high] = [high, low];
    const chunks: { from: number; to: number; step: number }[] = [];
    for (let k = 0; k < fillLen; k++) {
      const step = quantizedStep(low + ((high - low) * (k + 0.5)) / fillLen, weekMin, weekMax);
      const last = chunks[chunks.length - 1];
      if (last && last.step === step) {
        last.to = k + 1;
      } else {
        chunks.push({ from: k, to: k + 1, step });
      }
    }
    for (const chunk of chunks) {
      segments.push({
        text: FILL_GLYPH.repeat(chunk.to - chunk.from),
        fg: lerpHex(cold, warm, chunk.step / (GRADIENT_STEPS - 1)),
      });
    }
  }

  if (end < w) segments.push({ text: PAD_GLYPH.repeat(w - end), fg: padFg });
  return segments;
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
  const segments = rangeBarSegments(
    lo,
    hi,
    weekMin,
    weekMax,
    width,
    palette.tempCold,
    palette.tempWarm,
    palette.fgDim,
  );
  let offset = 0;
  return (
    <box flexDirection="row">
      <text>
        {segments.map((segment) => {
          const key = offset;
          offset += segment.text.length;
          return (
            <span key={key} fg={segment.fg}>
              {segment.text}
            </span>
          );
        })}
      </text>
    </box>
  );
}
