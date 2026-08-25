import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ForecastWindow, ProviderError, type WeatherProvider } from "../providers/types";
import type { GeoPoint, NormalizedForecast } from "./types";

const DEFAULT_MAX_AGE_MINUTES = 10;
const MIN_MS = 60_000;

export interface CacheResult {
  forecast: NormalizedForecast;
  stale: boolean;
}

export interface CacheIo {
  baseDir(): Promise<string>;
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function cacheKey(
  providerId: string,
  latitude: number,
  longitude: number,
  window?: ForecastWindow,
): string {
  const windowTag =
    window === undefined ? "" : `|${window.forecastDays ?? "*"}|${window.forecastHours ?? "*"}`;
  const digest = createHash("sha256")
    .update(`${providerId}|${latitude.toFixed(3)}|${longitude.toFixed(3)}${windowTag}`)
    .digest("hex");
  return `${digest}.json`;
}

interface Envelope {
  fetchedAtUtc: string;
  forecast: NormalizedForecast;
}

function parseEnvelope(raw: string | null): Envelope | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const fetchedAtUtc = record.fetchedAtUtc;
  const forecast = record.forecast;
  if (typeof fetchedAtUtc !== "string" || Number.isNaN(Date.parse(fetchedAtUtc))) {
    return null;
  }
  if (typeof forecast !== "object" || forecast === null) return null;
  const shape = forecast as Record<string, unknown>;
  if (!Array.isArray(shape.minutely15)) return null;
  return { fetchedAtUtc, forecast: forecast as NormalizedForecast };
}

class FsCacheIo implements CacheIo {
  async baseDir(): Promise<string> {
    const root = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
    const dir = join(root, "tuiweather");
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async read(key: string): Promise<string | null> {
    try {
      return await readFile(join(await this.baseDir(), key), "utf8");
    } catch {
      return null;
    }
  }

  async write(key: string, text: string): Promise<void> {
    await writeFile(join(await this.baseDir(), key), text, "utf8");
  }

  async remove(key: string): Promise<void> {
    await rm(join(await this.baseDir(), key), { force: true });
  }
}

export async function cachedForecast(
  provider: WeatherProvider,
  location: GeoPoint,
  opts?: { maxAgeMinutes?: number; nowUtc?: string; window?: ForecastWindow },
  io: CacheIo = new FsCacheIo(),
): Promise<CacheResult> {
  const maxAgeMinutes = opts?.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES;
  const nowUtc = opts?.nowUtc ?? new Date().toISOString();
  const nowMs = Date.parse(nowUtc);
  const key = cacheKey(provider.id, location.latitude, location.longitude, opts?.window);

  const raw = await io.read(key);
  const envelope = parseEnvelope(raw);
  if (raw !== null && envelope === null) {
    await io.remove(key).catch(() => undefined);
  }
  if (envelope && nowMs - Date.parse(envelope.fetchedAtUtc) <= maxAgeMinutes * MIN_MS) {
    return { forecast: envelope.forecast, stale: false };
  }

  try {
    const forecast = await provider.getForecast(location, opts?.window);
    await io.write(key, JSON.stringify({ fetchedAtUtc: nowUtc, forecast } satisfies Envelope));
    return { forecast, stale: false };
  } catch (error) {
    if (envelope && error instanceof ProviderError) {
      return { forecast: envelope.forecast, stale: true };
    }
    throw error;
  }
}
