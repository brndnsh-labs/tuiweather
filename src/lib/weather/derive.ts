import type { NormalizedForecast } from "./types";

/**
 * Buckets at or above this are wet. Open-Meteo labels each minutely_15 bucket
 * by its END instant, so a bucket here spans [startUtc, endUtc) — the preceding
 * interval relative to its label.
 */
export const WET_MM = 0.03;

export type Intensity = "light" | "moderate" | "heavy";

export type Nowcast =
  | { kind: "dry" }
  | { kind: "unavailable" }
  | { kind: "starting"; startsInMin: number; intensity: Intensity }
  | { kind: "stopping"; endsInMin: number }
  | { kind: "ongoing"; endsInMin: number | null; horizonMin: number; intensity: Intensity };

export interface PrecipWindow {
  startUtc: string;
  endUtc: string;
  totalMm: number;
}

interface Bucket {
  startMs: number;
  endMs: number;
  precipMm: number;
}

const LIGHT_MM = 0.1;
const MODERATE_MM = 0.4;
const MIN_MS = 60_000;

function minutesUntil(targetMs: number, nowMs: number): number {
  return Math.ceil((targetMs - nowMs) / MIN_MS);
}

function toIntensity(precipMm: number): Intensity {
  if (precipMm < LIGHT_MM) return "light";
  if (precipMm < MODERATE_MM) return "moderate";
  return "heavy";
}

/**
 * Block glyph for one 15-minute bucket: dry floor below WET_MM, then the
 * toIntensity bands scaled up.
 */
export function precipGlyph(mm: number): string {
  if (mm < WET_MM) return "▁";
  if (mm < LIGHT_MM) return "▃";
  if (mm < MODERATE_MM) return "▅";
  return "█";
}

function sortedBuckets(f: NormalizedForecast): Bucket[] {
  return f.minutely15
    .map((b) => ({
      startMs: Date.parse(b.startUtc),
      endMs: Date.parse(b.endUtc),
      precipMm: b.precipMm,
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

export function deriveNowcast(f: NormalizedForecast, nowUtc: string): Nowcast {
  if (!f.hasMinutePrecip) return { kind: "unavailable" };
  const nowMs = Date.parse(nowUtc);
  const buckets = sortedBuckets(f);

  const first = buckets[0];
  const last = buckets.at(-1);
  if (!first || !last || nowMs < first.startMs || nowMs >= last.endMs) {
    return { kind: "dry" };
  }

  const wet = buckets.filter((b) => b.precipMm >= WET_MM);

  const currentIdx = wet.findIndex((b) => nowMs >= b.startMs && nowMs < b.endMs);
  if (currentIdx >= 0) {
    const current = wet[currentIdx];
    if (!current) return { kind: "dry" };
    let stretchEndMs = current.endMs;
    let lastIdx = currentIdx;
    while (lastIdx + 1 < wet.length) {
      const cur = wet[lastIdx];
      const next = wet[lastIdx + 1];
      if (!cur || !next || next.startMs > cur.endMs) break;
      stretchEndMs = next.endMs;
      lastIdx += 1;
    }
    const intensity = toIntensity(current.precipMm);
    const seriesEnd = buckets.at(-1);
    if (lastIdx === wet.length - 1 && seriesEnd && seriesEnd.endMs <= stretchEndMs) {
      const horizonMin = Math.max(1, Math.round((seriesEnd.endMs - nowMs) / MIN_MS));
      return { kind: "ongoing", endsInMin: null, horizonMin, intensity };
    }
    return { kind: "stopping", endsInMin: minutesUntil(stretchEndMs, nowMs) };
  }

  const upcoming = wet.find((b) => b.startMs > nowMs);
  if (!upcoming) return { kind: "dry" };
  return {
    kind: "starting",
    startsInMin: minutesUntil(upcoming.startMs, nowMs),
    intensity: toIntensity(upcoming.precipMm),
  };
}

/**
 * Per-15-min precipitation from the bucket containing now through the end of
 * minutely15 data. Buckets are labeled by their END instant, so the bucket
 * spanning [startUtc, endUtc) with startUtc <= now < endUtc counts as
 * upcoming; empty when now is outside the data window.
 */
export function upcomingPrecipSeries(f: NormalizedForecast, nowUtc: string): number[] {
  const nowMs = Date.parse(nowUtc);
  const buckets = sortedBuckets(f);

  const first = buckets[0];
  const last = buckets.at(-1);
  if (!first || !last || nowMs < first.startMs || nowMs >= last.endMs) {
    return [];
  }

  const series: number[] = [];
  for (const b of buckets) {
    if (b.endMs > nowMs) series.push(b.precipMm);
  }
  return series;
}

const INTENSITY_WORD: Record<Intensity, string> = {
  light: "Light rain",
  moderate: "Rain",
  heavy: "Heavy rain",
};

export function describeNowcast(n: Nowcast): string {
  switch (n.kind) {
    case "dry":
      return "Dry";
    case "unavailable":
      return "Nowcast unavailable";
    case "starting": {
      const word = INTENSITY_WORD[n.intensity];
      return n.startsInMin < 1
        ? `${word} starting any minute`
        : `${word} starting in ${n.startsInMin} min`;
    }
    case "stopping":
      return `Rain stopping in ${n.endsInMin} min`;
    case "ongoing":
      return n.endsInMin === null
        ? `Rain for at least ${n.horizonMin} min`
        : `Rain stopping in ${n.endsInMin} min`;
  }
}

export function todayPrecipWindow(f: NormalizedForecast, nowUtc: string): PrecipWindow | null {
  const nowMs = Date.parse(nowUtc);
  const wet = sortedBuckets(f).filter((b) => b.precipMm >= WET_MM && b.endMs > nowMs);
  const firstWet = wet[0];
  if (!firstWet) return null;
  let endMs = firstWet.endMs;
  let totalMm = firstWet.precipMm;
  for (let i = 1; i < wet.length; i++) {
    const prev = wet[i - 1];
    const cur = wet[i];
    if (!prev || !cur || cur.startMs > prev.endMs) break;
    endMs = cur.endMs;
    totalMm += cur.precipMm;
  }
  return {
    startUtc: new Date(firstWet.startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    totalMm,
  };
}
