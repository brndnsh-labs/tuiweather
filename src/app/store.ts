import { create } from "zustand";
import { loadConfig } from "../lib/config/load";
import { saveConfig } from "../lib/config/save";
import { DEFAULT_CONFIG, type TuiConfig } from "../lib/config/schema";
import { fetchForecast, OPENMETEO_PROVIDER_ID } from "../lib/providers/openmeteo/client";
import type { WeatherProvider } from "../lib/providers/types";
import { cachedForecast } from "../lib/weather/cache";
import type { GeoPoint, NormalizedForecast } from "../lib/weather/types";

export type ForecastFetcher = (
  location: GeoPoint,
  opts: { maxAgeMinutes: number },
) => Promise<{
  forecast: NormalizedForecast;
  stale: boolean;
}>;

export interface ForecastEntry {
  forecast: NormalizedForecast;
  fetchedAtMs: number;
}

export interface StoreDeps {
  configPath?: string;
  fetchForecast?: ForecastFetcher;
}

const OPENMETEO_PROVIDER: WeatherProvider = {
  id: OPENMETEO_PROVIDER_ID,
  getForecast: (location) => fetchForecast(location),
};

export const defaultFetcher: ForecastFetcher = (location, opts) =>
  cachedForecast(OPENMETEO_PROVIDER, location, { maxAgeMinutes: opts.maxAgeMinutes });

export function prodDeps(): Required<Pick<StoreDeps, "fetchForecast">> {
  return { fetchForecast: defaultFetcher };
}

export interface WeatherState {
  config: TuiConfig;
  activeSlug: string | null;
  forecastBySlug: Record<string, ForecastEntry>;
  loadingSlugs: Record<string, true>;
  errorBySlug: Record<string, string>;
  staleBySlug: Record<string, boolean>;
  lastActionError: string | undefined;
  helpOpen: boolean;

  init(explicitSlug?: string): Promise<void>;
  loadForecast(slug: string, opts?: { bypassCache?: boolean }): Promise<void>;
  refresh(slug: string | null): Promise<void>;
  switchLocation(slug: string): void;
  cycleLocation(delta: 1 | -1): void;
  toggleUnits(): void;
  toggleHelp(): void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function findLocation(config: TuiConfig, slug: string) {
  return config.locations.find((loc) => loc.slug === slug);
}

function withoutKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function resolveDefaultSlug(config: TuiConfig, explicitSlug?: string): string | null {
  if (explicitSlug && findLocation(config, explicitSlug)) return explicitSlug;
  if (config.default_location && findLocation(config, config.default_location)) {
    return config.default_location;
  }
  return config.locations[0]?.slug ?? null;
}

export function createStoreInstance(deps: StoreDeps = prodDeps()) {
  const fetcher = deps.fetchForecast ?? defaultFetcher;

  return create<WeatherState>()((set, get) => ({
    config: DEFAULT_CONFIG,
    activeSlug: null,
    forecastBySlug: {},
    loadingSlugs: {},
    errorBySlug: {},
    staleBySlug: {},
    lastActionError: undefined,
    helpOpen: false,

    init: async (explicitSlug?: string) => {
      try {
        const config = await loadConfig(deps.configPath);
        const slug = resolveDefaultSlug(config, explicitSlug);
        set({ config, activeSlug: slug });
        if (slug) await get().loadForecast(slug);
      } catch (e) {
        set({ lastActionError: errorMessage(e) });
      }
    },

    loadForecast: async (slug: string, opts?: { bypassCache?: boolean }) => {
      const state = get();
      const location = findLocation(state.config, slug);
      if (!location) {
        set((s) => ({ errorBySlug: { ...s.errorBySlug, [slug]: `unknown location "${slug}"` } }));
        return;
      }
      set((s) => ({ loadingSlugs: { ...s.loadingSlugs, [slug]: true as const } }));
      try {
        const result = await fetcher(
          { latitude: location.latitude, longitude: location.longitude },
          {
            maxAgeMinutes: opts?.bypassCache === true ? 0 : get().config.refresh_minutes,
          },
        );
        set((s) => ({
          forecastBySlug: {
            ...s.forecastBySlug,
            [slug]: {
              forecast: result.forecast,
              fetchedAtMs: Date.parse(result.forecast.fetchedAtUtc),
            },
          },
          staleBySlug: { ...s.staleBySlug, [slug]: result.stale },
          errorBySlug: withoutKey(s.errorBySlug, slug),
        }));
      } catch (e) {
        set((s) => ({ errorBySlug: { ...s.errorBySlug, [slug]: errorMessage(e) } }));
      } finally {
        set((s) => ({ loadingSlugs: withoutKey(s.loadingSlugs, slug) }));
      }
    },

    refresh: async (slug: string | null) => {
      if (!slug || !findLocation(get().config, slug)) return;
      await get().loadForecast(slug, { bypassCache: true });
    },

    switchLocation: (slug: string) => {
      if (!findLocation(get().config, slug)) return;
      set({ activeSlug: slug });
      void get().loadForecast(slug);
    },

    cycleLocation: (delta: 1 | -1) => {
      const locations = get().config.locations;
      if (locations.length === 0) return;
      const currentIdx = locations.findIndex((loc) => loc.slug === get().activeSlug);
      const nextIdx =
        ((((currentIdx === -1 ? 0 : currentIdx) + delta) % locations.length) + locations.length) %
        locations.length;
      const next = locations[nextIdx];
      if (!next) return;
      get().switchLocation(next.slug);
    },

    toggleUnits: () => {
      const config = get().config;
      const units: TuiConfig["units"] = config.units === "metric" ? "imperial" : "metric";
      const next: TuiConfig = { ...config, units };
      set({ config: next });
      void saveConfig(next, deps.configPath).catch((e: unknown) => {
        set({ lastActionError: errorMessage(e) });
      });
    },

    toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  }));
}

export type WeatherStore = ReturnType<typeof createStoreInstance>;

export const appStore: WeatherStore = createStoreInstance(prodDeps());
