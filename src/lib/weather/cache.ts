import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type ForecastWindow, ProviderError, type WeatherProvider } from "../providers/types";
import type { AirQuality, Condition, GeoPoint, NormalizedForecast } from "./types";

export const CACHE_SCHEMA_VERSION = 2;

const DEFAULT_MAX_AGE_MINUTES = 10;
const AQ_TTL_MINUTES = 60;
const MIN_MS = 60_000;

const conditionSchema = z.enum([
  "clear",
  "mostly-clear",
  "partly-cloudy",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "freezing-rain",
  "snow",
  "heavy-snow",
  "sleet",
  "thunderstorm",
  "hail",
]);
type SchemaCondition = z.infer<typeof conditionSchema>;
type ConditionTypesMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _conditionSchemaMatchesType: ConditionTypesMatch<SchemaCondition, Condition> = true;

const numberField = z.number();
const nullableNumber = z.number().nullable();

const currentObsSchema = z.object({
  timeUtc: z.string(),
  temperatureC: numberField,
  apparentC: numberField,
  humidityPct: numberField,
  condition: conditionSchema,
  windSpeedKmh: numberField,
  windDirectionDeg: numberField,
  windGustKmh: nullableNumber,
  pressureHpa: nullableNumber,
  dewPointC: nullableNumber,
  visibilityM: nullableNumber,
  uvIndex: nullableNumber,
  isDay: z.boolean(),
});

const precipIntervalSchema = z.object({
  startUtc: z.string(),
  endUtc: z.string(),
  precipMm: numberField,
  probabilityPct: nullableNumber,
});

const hourlyPointSchema = z.object({
  timeUtc: z.string(),
  temperatureC: numberField,
  apparentC: numberField,
  precipMm: numberField,
  precipProbabilityPct: nullableNumber,
  condition: conditionSchema,
  windSpeedKmh: numberField,
  windGustKmh: nullableNumber,
  windDirectionDeg: numberField,
  humidityPct: nullableNumber,
  uvIndex: nullableNumber,
  visibilityM: nullableNumber,
  isDay: z.boolean(),
});

const dailyPointSchema = z.object({
  dateLocal: z.string(),
  condition: conditionSchema,
  tempMinC: numberField,
  tempMaxC: numberField,
  precipSumMm: numberField,
  precipProbabilityMaxPct: nullableNumber,
  sunriseUtc: z.string().nullable(),
  sunsetUtc: z.string().nullable(),
  windSpeedMaxKmh: nullableNumber,
});

const normalizedForecastSchema = z.object({
  providerId: z.string(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  timezone: z.string(),
  utcOffsetSeconds: z.number(),
  fetchedAtUtc: z.string(),
  current: currentObsSchema,
  hasMinutePrecip: z.boolean(),
  minutely15: z.array(precipIntervalSchema),
  hourly: z.array(hourlyPointSchema),
  daily: z.array(dailyPointSchema),
});

const envelopeSchema = z.object({
  version: z.literal(CACHE_SCHEMA_VERSION),
  fetchedAtUtc: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "fetchedAtUtc is not a parseable instant",
  }),
  forecast: normalizedForecastSchema,
});

const airQualitySchema = z.object({
  usAqi: z.number().nullable(),
  observedAtUtc: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "observedAtUtc is not a parseable instant",
  }),
});

const aqEnvelopeSchema = z.object({
  version: z.literal(CACHE_SCHEMA_VERSION),
  fetchedAtUtc: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "fetchedAtUtc is not a parseable instant",
  }),
  airQuality: airQualitySchema,
});

export interface CacheResult {
  forecast: NormalizedForecast;
  stale: boolean;
}

export interface AqCacheResult {
  airQuality: AirQuality;
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
    .update(
      `${CACHE_SCHEMA_VERSION}|${providerId}|${latitude.toFixed(3)}|${longitude.toFixed(3)}${windowTag}`,
    )
    .digest("hex");
  return `${digest}.json`;
}

export function airQualityCacheKey(
  providerId: string,
  latitude: number,
  longitude: number,
): string {
  const digest = createHash("sha256")
    .update(
      `${CACHE_SCHEMA_VERSION}|${providerId}|aq|${latitude.toFixed(3)}|${longitude.toFixed(3)}`,
    )
    .digest("hex");
  return `${digest}.json`;
}

interface Envelope {
  version: typeof CACHE_SCHEMA_VERSION;
  fetchedAtUtc: string;
  forecast: NormalizedForecast;
}

interface AqEnvelope {
  version: typeof CACHE_SCHEMA_VERSION;
  fetchedAtUtc: string;
  airQuality: AirQuality;
}

function parseEnvelope(raw: string | null): Envelope | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

function parseAqEnvelope(raw: string | null): AqEnvelope | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = aqEnvelopeSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

export function cacheRoot(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string {
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg) return xdg;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) return localAppData;
  }
  return join(homedir(), ".cache");
}

class FsCacheIo implements CacheIo {
  async baseDir(): Promise<string> {
    const root = cacheRoot(process.platform, process.env);
    const dir = join(root, "tuiweather");
    await mkdir(dir, { recursive: true, mode: 0o700 });
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
    const dir = await this.baseDir();
    const target = join(dir, key);
    const tmp = join(dir, `${key}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
    let created = false;
    try {
      const handle = await open(tmp, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(tmp, 0o600);
      await rename(tmp, target);
    } catch (e) {
      if (created) await unlink(tmp).catch(() => undefined);
      throw e;
    }
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
    await io.write(
      key,
      JSON.stringify({
        version: CACHE_SCHEMA_VERSION,
        fetchedAtUtc: nowUtc,
        forecast,
      } satisfies Envelope),
    );
    return { forecast, stale: false };
  } catch (error) {
    if (envelope && error instanceof ProviderError) {
      return { forecast: envelope.forecast, stale: true };
    }
    throw error;
  }
}

export async function cachedAirQuality(
  provider: WeatherProvider,
  location: GeoPoint,
  opts?: { nowUtc?: string },
  io: CacheIo = new FsCacheIo(),
): Promise<AqCacheResult> {
  const nowUtc = opts?.nowUtc ?? new Date().toISOString();
  const nowMs = Date.parse(nowUtc);
  const key = airQualityCacheKey(provider.id, location.latitude, location.longitude);

  const raw = await io.read(key);
  const envelope = parseAqEnvelope(raw);
  if (raw !== null && envelope === null) {
    await io.remove(key).catch(() => undefined);
  }
  if (envelope && nowMs - Date.parse(envelope.fetchedAtUtc) <= AQ_TTL_MINUTES * MIN_MS) {
    return { airQuality: envelope.airQuality, stale: false };
  }

  if (!provider.getAirQuality) {
    throw new ProviderError("provider does not support air quality", provider.id);
  }

  try {
    const airQuality = await provider.getAirQuality(location);
    await io.write(
      key,
      JSON.stringify({
        version: CACHE_SCHEMA_VERSION,
        fetchedAtUtc: nowUtc,
        airQuality,
      } satisfies AqEnvelope),
    );
    return { airQuality, stale: false };
  } catch (error) {
    if (envelope && error instanceof ProviderError) {
      return { airQuality: envelope.airQuality, stale: true };
    }
    throw error;
  }
}
