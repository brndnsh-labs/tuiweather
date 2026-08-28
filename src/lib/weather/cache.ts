import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type ForecastWindow, ProviderError, type WeatherProvider } from "../providers/types";
import type { Condition, GeoPoint, NormalizedForecast } from "./types";

const DEFAULT_MAX_AGE_MINUTES = 10;
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
  cloudCoverPct: nullableNumber,
  dewPointC: nullableNumber,
  visibilityM: nullableNumber,
  uvIndex: nullableNumber,
  precipLast1hMm: nullableNumber,
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
  isDay: z.boolean(),
});

const dailyPointSchema = z.object({
  dateLocal: z.string(),
  condition: conditionSchema,
  tempMinC: numberField,
  tempMaxC: numberField,
  precipSumMm: numberField,
  precipProbabilityMaxPct: nullableNumber,
  uvIndexMax: nullableNumber,
  sunriseUtc: z.string().nullable(),
  sunsetUtc: z.string().nullable(),
  windSpeedMaxKmh: nullableNumber,
  windGustMaxKmh: nullableNumber,
});

const normalizedForecastSchema = z.object({
  providerId: z.string(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  timezone: z.string(),
  utcOffsetSeconds: z.number(),
  fetchedAtUtc: z.string(),
  current: currentObsSchema,
  minutely15: z.array(precipIntervalSchema),
  hourly: z.array(hourlyPointSchema),
  daily: z.array(dailyPointSchema),
});

const envelopeSchema = z.object({
  fetchedAtUtc: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "fetchedAtUtc is not a parseable instant",
  }),
  forecast: normalizedForecastSchema,
});

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
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

class FsCacheIo implements CacheIo {
  async baseDir(): Promise<string> {
    const root = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
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
    await io.write(key, JSON.stringify({ fetchedAtUtc: nowUtc, forecast } satisfies Envelope));
    return { forecast, stale: false };
  } catch (error) {
    if (envelope && error instanceof ProviderError) {
      return { forecast: envelope.forecast, stale: true };
    }
    throw error;
  }
}
