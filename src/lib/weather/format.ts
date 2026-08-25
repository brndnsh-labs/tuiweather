export type Units = "metric" | "imperial";

const COMPASS_16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const EN_DASH = "–";
const MM_PER_INCH = 25.4;
const MPH_PER_KMH = 0.621371;
const M_PER_KM = 1000;
const M_PER_MI = 1609.344;

function compassPoint(deg: number): string {
  const idx = ((Math.round(deg / 22.5) % 16) + 16) % 16;
  return COMPASS_16[idx] ?? "N";
}

function shiftUtc(isoUtc: string, utcOffsetSeconds: number): Date {
  return new Date(Date.parse(isoUtc) + utcOffsetSeconds * 1000);
}

export function convertTempC(c: number, units: Units): number {
  return units === "imperial" ? (c * 9) / 5 + 32 : c;
}

const TEMP_WARMTH_FLOOR_C = 0;
const TEMP_WARMTH_CEIL_C = 35;

/**
 * Normalized cold→warm position for coloring the hero temperature:
 * 0 at/below freezing, 1 at/above 35 °C, linear in between.
 */
export function tempWarmthT(celsius: number): number {
  const span = TEMP_WARMTH_CEIL_C - TEMP_WARMTH_FLOOR_C;
  const t = (celsius - TEMP_WARMTH_FLOOR_C) / span;
  return Math.max(0, Math.min(1, t));
}

export function formatTemp(c: number | null, units: Units): string {
  if (c === null) return EN_DASH;
  return `${Math.round(convertTempC(c, units))}°`;
}

export function formatWind(speedKmh: number | null, dirDeg: number | null, units: Units): string {
  if (speedKmh === null) return EN_DASH;
  const speed = units === "imperial" ? Math.round(speedKmh * MPH_PER_KMH) : Math.round(speedKmh);
  const unit = units === "imperial" ? "mph" : "km/h";
  const compass = dirDeg === null ? "" : ` ${compassPoint(dirDeg)}`;
  return `${speed} ${unit}${compass}`;
}

export function formatPrecip(mm: number | null, units: Units): string {
  if (mm === null) return EN_DASH;
  if (units === "imperial") return `${(mm / MM_PER_INCH).toFixed(2)} in`;
  return `${Number.parseFloat(mm.toFixed(1))} mm`;
}

export function formatPct(p: number | null): string {
  if (p === null) return EN_DASH;
  return `${Math.round(p)}%`;
}

export function formatVisibility(meters: number | null, units: Units): string {
  if (meters === null) return "--";
  if (units === "imperial") {
    return `${Number.parseFloat((meters / M_PER_MI).toFixed(1))} mi`;
  }
  return `${Number.parseFloat((meters / M_PER_KM).toFixed(1))} km`;
}

export function formatClock(isoUtc: string, utcOffsetSeconds: number): string {
  const shifted = shiftUtc(isoUtc, utcOffsetSeconds);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return EN_DASH;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const meridiem = hours < 12 ? "AM" : "PM";
  return `${h12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

export function formatHourLabel(isoUtc: string, utcOffsetSeconds: number): string {
  const shifted = shiftUtc(isoUtc, utcOffsetSeconds);
  const hours = shifted.getUTCHours();
  if (Number.isNaN(hours)) return EN_DASH;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}${hours < 12 ? "a" : "p"}`;
}

export function formatDayLabel(dateLocal: string): string {
  const parts = dateLocal.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return EN_DASH;
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[dow] ?? EN_DASH;
}

export function uvLabel(uv: number | null): string {
  if (uv === null) return "--";
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";
  return "Extreme";
}
