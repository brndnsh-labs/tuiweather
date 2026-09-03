import type { HourlyPoint, NormalizedForecast, PrecipInterval } from "./types";

/**
 * Buckets at or above this are wet. Open-Meteo labels each minutely_15 bucket
 * by its END instant, so a bucket here spans [startUtc, endUtc) — the preceding
 * interval relative to its label.
 */
export const WET_MM = 0.03;

/**
 * Hourly-summary dryness thresholds. Shared by the hourly strip's "is this
 * window dry" check and the comfort-window scorer below — kept here (not in
 * features/hourly/HourlyStrip.tsx, which re-exports them) so lib/ never has
 * to import from features/ (AGENTS.md hard rule).
 */
export const TRACE_MM = 0.05;
export const PROB_SUMMARY_PCT = 40;

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
 * Full-fidelity buckets (mm + probability) from the bucket containing now
 * through the end of minutely15 data. Buckets are labeled by their END
 * instant, so the bucket spanning [startUtc, endUtc) with startUtc <= now <
 * endUtc counts as upcoming; empty when now is outside the data window.
 */
export function upcomingPrecipBuckets(f: NormalizedForecast, nowUtc: string): PrecipInterval[] {
  const nowMs = Date.parse(nowUtc);
  const sorted = [...f.minutely15].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));

  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last || nowMs < Date.parse(first.startUtc) || nowMs >= Date.parse(last.endUtc)) {
    return [];
  }

  return sorted.filter((b) => Date.parse(b.endUtc) > nowMs);
}

/** Per-15-min precipitation amounts only — see upcomingPrecipBuckets for full fidelity. */
export function upcomingPrecipSeries(f: NormalizedForecast, nowUtc: string): number[] {
  return upcomingPrecipBuckets(f, nowUtc).map((b) => b.precipMm);
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

const HOUR_MS = 60 * MIN_MS;
const LOOKAHEAD_HOURS = 24;
const MIN_RUN_HOURS = 2;
const GO_OUT_THRESHOLD = 0.6;
const HEADS_UP_THRESHOLD = 0.25;
/**
 * Emission gate for the "heads up" window (see deriveComfortWindows doc) —
 * reuses the same gust penalty threshold as the scorer. Exported so the UI
 * layer's "gusts …" clause (ComfortLines.tsx) tests the identical threshold
 * instead of an untethered duplicate that could drift out of sync.
 */
export const HEADS_UP_GUST_KMH = 40;

const COMFORT_FLOOR_C = 0;
const COMFORT_LOW_C = 10;
const COMFORT_HIGH_C = 27;
const COMFORT_CEIL_C = 35;
/**
 * Full credit through the penalty threshold from the issue spec, linear
 * falloff to zero at the *_ZERO bound (not itself pinned by the issue).
 * Exported so format.ts's windComfortLabel band boundary stays tied to the
 * scorer's real threshold.
 */
export const WIND_SUSTAINED_PENALTY_KMH = 25;
const WIND_SUSTAINED_ZERO_KMH = 50;
const WIND_GUST_PENALTY_KMH = HEADS_UP_GUST_KMH;
const WIND_GUST_ZERO_KMH = 70;
const UV_PENALTY = 6;
const UV_ZERO = 11;
const DAYLIGHT_BONUS = 0.05;

export interface ComfortWindow {
  startUtc: string;
  endUtc: string;
  meanScore: number;
  temperatureC: number;
  windSpeedKmh: number;
  windGustKmh: number | null;
  uvIndex: number | null;
  precipMm: number;
}

export interface ComfortWindows {
  goOut: ComfortWindow | null;
  headsUp: ComfortWindow | null;
}

/** 1 outside [floor, ceil]→0, full credit on [low, high], linear ramps between. */
function trapezoid(value: number, floor: number, low: number, high: number, ceil: number): number {
  if (value <= floor || value >= ceil) return 0;
  if (value < low) return (value - floor) / (low - floor);
  if (value > high) return (ceil - value) / (ceil - high);
  return 1;
}

/** Full credit at/under `full`, zero at/over `zero`, linear between. */
function linearFalloff(value: number, full: number, zero: number): number {
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return (zero - value) / (zero - full);
}

function isDryHour(point: HourlyPoint): boolean {
  return point.precipMm < TRACE_MM && (point.precipProbabilityPct ?? 0) < PROB_SUMMARY_PCT;
}

function windScore(point: HourlyPoint): number {
  const sustained = linearFalloff(
    point.windSpeedKmh,
    WIND_SUSTAINED_PENALTY_KMH,
    WIND_SUSTAINED_ZERO_KMH,
  );
  const gust =
    point.windGustKmh === null
      ? 1
      : linearFalloff(point.windGustKmh, WIND_GUST_PENALTY_KMH, WIND_GUST_ZERO_KMH);
  return Math.min(sustained, gust);
}

function uvScore(point: HourlyPoint): number {
  return point.uvIndex === null ? 1 : linearFalloff(point.uvIndex, UV_PENALTY, UV_ZERO);
}

/**
 * Comfort-window score for one hourly point, 0-1. Factors multiply rather
 * than average, so any single severely bad one (not just dryness) can carry
 * the whole hour to near-zero — a "penalty" should cost the reading, not get
 * diluted by two other factors that happen to be fine. Dryness is still the
 * hardest gate: a wet or high-probability hour is zeroed outright (issue's
 * "dry, weighted hardest"), before comfort/wind/uv are even consulted.
 */
function comfortWindowScore(point: HourlyPoint): number {
  if (!isDryHour(point)) return 0;
  const comfort = trapezoid(
    point.apparentC,
    COMFORT_FLOOR_C,
    COMFORT_LOW_C,
    COMFORT_HIGH_C,
    COMFORT_CEIL_C,
  );
  const daylight = point.isDay ? DAYLIGHT_BONUS : 0;
  return Math.min(1, comfort * windScore(point) * uvScore(point) + daylight);
}

interface Run {
  startIdx: number;
  endIdx: number;
  mean: number;
}

/**
 * Best contiguous run (length >= MIN_RUN_HOURS) by `better`. Checks longest
 * runs first so a tie keeps the wider window rather than an arbitrary
 * shorter one at the same mean.
 */
function bestRun(
  scores: number[],
  better: (candidate: number, current: number) => boolean,
): Run | null {
  let best: Run | null = null;
  for (let length = scores.length; length >= MIN_RUN_HOURS; length--) {
    for (let start = 0; start + length <= scores.length; start++) {
      let sum = 0;
      for (let i = start; i < start + length; i++) sum += scores[i] ?? 0;
      const mean = sum / length;
      if (best === null || better(mean, best.mean)) {
        best = { startIdx: start, endIdx: start + length - 1, mean };
      }
    }
  }
  return best;
}

/**
 * Best run drawn only from maximal dry-only stretches of `points` (never
 * crossing a wet or high-probability hour). A "go out" window is a claim
 * that the whole window is dry — the per-point score already zeroes a wet
 * hour, but zero can still be *outvoted* by strong neighbors in a long
 * enough run (removing a below-mean point from an average never lowers it,
 * so the exhaustive search in `bestRun` would otherwise happily average
 * straight through a rained-on hour to clear the 0.6 bar). Segmenting first
 * makes that structurally impossible instead of relying on the score alone.
 */
function bestDryRun(points: HourlyPoint[], scores: number[]): Run | null {
  let best: Run | null = null;
  let segStart = 0;
  for (let i = 0; i <= points.length; i++) {
    const current = points[i];
    const atBoundary = i === points.length || current === undefined || !isDryHour(current);
    if (!atBoundary) continue;
    if (i - segStart >= MIN_RUN_HOURS) {
      const run = bestRun(scores.slice(segStart, i), (a, b) => a > b);
      if (run !== null) {
        const candidate: Run = {
          startIdx: segStart + run.startIdx,
          endIdx: segStart + run.endIdx,
          mean: run.mean,
        };
        const currentLen = best === null ? -1 : best.endIdx - best.startIdx;
        if (
          best === null ||
          candidate.mean > best.mean ||
          (candidate.mean === best.mean && candidate.endIdx - candidate.startIdx > currentLen)
        ) {
          best = candidate;
        }
      }
    }
    segStart = i + 1;
  }
  return best;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function aggregateWindow(points: HourlyPoint[], run: Run): ComfortWindow {
  const slice = points.slice(run.startIdx, run.endIdx + 1);
  const first = slice[0];
  const last = slice[slice.length - 1];
  if (!first || !last) throw new Error("aggregateWindow: empty run");
  const uvValues = slice.map((p) => p.uvIndex).filter((v): v is number => v !== null);
  const gustValues = slice.map((p) => p.windGustKmh).filter((v): v is number => v !== null);
  return {
    // Hourly points are labeled by their interval's END instant (hard rule 3);
    // the window's start is one hour before its first point's label.
    startUtc: new Date(Date.parse(first.timeUtc) - HOUR_MS).toISOString(),
    endUtc: last.timeUtc,
    meanScore: run.mean,
    temperatureC: mean(slice.map((p) => p.temperatureC)),
    windSpeedKmh: mean(slice.map((p) => p.windSpeedKmh)),
    windGustKmh: gustValues.length > 0 ? Math.max(...gustValues) : null,
    uvIndex: uvValues.length > 0 ? mean(uvValues) : null,
    precipMm: Math.max(...slice.map((p) => p.precipMm)),
  };
}

/**
 * The best ("go out") and worst ("heads up") >= 2-hour windows in the next
 * 24 hours of hourly forecast data, or null when nothing clears the
 * threshold. "go out" needs a mean comfort score >= 0.6; "heads up" needs a
 * mean score <= 0.25 *and* an actual hazard in the run (wet, or a gust at or
 * above WIND_GUST_PENALTY_KMH) — a merely chilly, calm evening scores low
 * but isn't a hazard, so it's suppressed rather than flagged.
 */
export function deriveComfortWindows(f: NormalizedForecast, nowUtc: string): ComfortWindows {
  const nowMs = Date.parse(nowUtc);
  const horizonMs = nowMs + LOOKAHEAD_HOURS * HOUR_MS;
  const points = f.hourly.filter((p) => {
    const t = Date.parse(p.timeUtc);
    return t > nowMs && t <= horizonMs;
  });
  if (points.length < MIN_RUN_HOURS) return { goOut: null, headsUp: null };

  const scores = points.map(comfortWindowScore);

  const goOutRun = bestDryRun(points, scores);
  const goOut =
    goOutRun !== null && goOutRun.mean >= GO_OUT_THRESHOLD
      ? aggregateWindow(points, goOutRun)
      : null;

  const headsUpRun = bestRun(scores, (candidate, current) => candidate < current);
  const headsUpSlice =
    headsUpRun !== null ? points.slice(headsUpRun.startIdx, headsUpRun.endIdx + 1) : [];
  const hasHazard = headsUpSlice.some(
    (p) => p.precipMm >= TRACE_MM || (p.windGustKmh !== null && p.windGustKmh >= HEADS_UP_GUST_KMH),
  );
  const headsUp =
    headsUpRun !== null && headsUpRun.mean <= HEADS_UP_THRESHOLD && hasHazard
      ? aggregateWindow(points, headsUpRun)
      : null;

  return { goOut, headsUp };
}
