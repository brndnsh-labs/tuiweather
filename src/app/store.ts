import {
  clearInterval as timersClearInterval,
  setInterval as timersSetInterval,
} from "node:timers";
import { create } from "zustand";
import { uniqueSlug } from "../features/search/SearchOverlay";
import { loadConfig } from "../lib/config/load";
import { saveConfig } from "../lib/config/save";
import { DEFAULT_CONFIG, type TuiConfig } from "../lib/config/schema";
import { fetchForecast, OPENMETEO_PROVIDER_ID } from "../lib/providers/openmeteo/client";
import {
  type GeocodingResult,
  searchLocations as geocodeLocations,
} from "../lib/providers/openmeteo/geocoding";
import type { ForecastWindow, WeatherProvider } from "../lib/providers/types";
import { cachedForecast } from "../lib/weather/cache";
import type { GeoPoint, NormalizedForecast } from "../lib/weather/types";

export type ForecastFetcher = (
  location: GeoPoint,
  opts: { maxAgeMinutes: number; window: ForecastWindow },
) => Promise<{
  forecast: NormalizedForecast;
  stale: boolean;
}>;

export type LocationEntry = TuiConfig["locations"][number];
export type SearchLocationsFn = (query: string) => Promise<GeocodingResult[]>;

export interface RefreshTimerDeps {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_REFRESH_TIMERS: RefreshTimerDeps = {
  setInterval: (handler, ms) => {
    const handle = timersSetInterval(handler, ms);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => timersClearInterval(handle as NodeJS.Timeout),
};

export interface ForecastEntry {
  forecast: NormalizedForecast;
  fetchedAtMs: number;
}

export interface StoreDeps {
  configPath?: string;
  fetchForecast?: ForecastFetcher;
  searchLocations?: SearchLocationsFn;
  refreshTimers?: RefreshTimerDeps;
}

const OPENMETEO_PROVIDER: WeatherProvider = {
  id: OPENMETEO_PROVIDER_ID,
  getForecast: (location, window) => fetchForecast(location, window),
};

export const defaultFetcher: ForecastFetcher = (location, opts) =>
  cachedForecast(OPENMETEO_PROVIDER, location, {
    maxAgeMinutes: opts.maxAgeMinutes,
    window: opts.window,
  });

export const defaultSearchLocations: SearchLocationsFn = (query) => geocodeLocations(query);

export function prodDeps(): Required<Pick<StoreDeps, "fetchForecast">> {
  return { fetchForecast: defaultFetcher };
}

export interface WeatherState {
  initStatus: "idle" | "loading" | "ready" | "error";
  config: TuiConfig;
  activeSlug: string | null;
  forecastBySlug: Record<string, ForecastEntry>;
  loadingSlugs: Record<string, true>;
  errorBySlug: Record<string, string>;
  staleBySlug: Record<string, boolean>;
  lastActionError: string | undefined;
  helpOpen: boolean;
  overlayOpen: boolean;

  init(explicitSlug?: string): Promise<void>;
  loadForecast(slug: string, opts?: { bypassCache?: boolean }): Promise<void>;
  refresh(slug: string | null): Promise<void>;
  switchLocation(slug: string): void;
  cycleLocation(delta: 1 | -1): void;
  toggleUnits(): Promise<void>;
  toggleHelp(): void;
  setOverlayOpen(open: boolean): void;
  searchLocations(query: string): Promise<GeocodingResult[]>;
  addLocation(entry: LocationEntry): Promise<void>;
  completeOnboarding(entry: LocationEntry, units: TuiConfig["units"]): Promise<boolean>;
  deleteActiveLocation(): Promise<void>;
  dispose(): void;
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
  const geocoder = deps.searchLocations ?? defaultSearchLocations;
  const timerDeps = deps.refreshTimers ?? DEFAULT_REFRESH_TIMERS;

  return create<WeatherState>()((set, get) => {
    let refreshHandle: unknown;
    let disposed = false;

    function clearRefreshTimer(): void {
      if (refreshHandle === undefined) return;
      const handle = refreshHandle;
      refreshHandle = undefined;
      timerDeps.clearInterval(handle);
    }

    /**
     * Single periodic loader for the active slug. Always clears any prior
     * interval first so init/switch/refresh calls can never stack timers.
     */
    function scheduleRefreshLoop(): void {
      clearRefreshTimer();
      if (disposed) return;
      if (get().activeSlug === null) return;
      refreshHandle = timerDeps.setInterval(() => {
        if (disposed) return;
        const slug = get().activeSlug;
        if (slug === null) return;
        void get().loadForecast(slug);
      }, get().config.refresh_minutes * 60_000);
    }

    return {
      initStatus: "idle",
      config: DEFAULT_CONFIG,
      activeSlug: null,
      forecastBySlug: {},
      loadingSlugs: {},
      errorBySlug: {},
      staleBySlug: {},
      lastActionError: undefined,
      helpOpen: false,
      overlayOpen: false,

      init: async (explicitSlug?: string) => {
        set({ initStatus: "loading", lastActionError: undefined });
        try {
          const config = await loadConfig(deps.configPath);
          const slug = resolveDefaultSlug(config, explicitSlug);
          set({ config, activeSlug: slug, initStatus: "ready" });
          if (slug) {
            await get().loadForecast(slug);
            if (!disposed) {
              void Promise.allSettled(
                config.locations
                  .filter((loc) => loc.slug !== slug)
                  .map((loc) => get().loadForecast(loc.slug)),
              );
            }
          }
          scheduleRefreshLoop();
        } catch (e) {
          set({ initStatus: "error", lastActionError: errorMessage(e) });
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
              window: {
                forecastDays: state.config.daily_days,
                forecastHours: state.config.hourly_hours,
              },
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
        scheduleRefreshLoop();
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

      toggleUnits: async () => {
        const config = get().config;
        const units: TuiConfig["units"] = config.units === "metric" ? "imperial" : "metric";
        const next: TuiConfig = { ...config, units };
        set({ config: next });
        await saveConfig(next, deps.configPath).catch((e: unknown) => {
          set({ lastActionError: errorMessage(e) });
        });
      },

      toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),

      setOverlayOpen: (open: boolean) => set({ overlayOpen: open }),

      searchLocations: (query: string) => geocoder(query),

      addLocation: async (entry: LocationEntry) => {
        const config = get().config;
        const slug = uniqueSlug(
          entry.slug,
          config.locations.map((loc) => loc.slug),
        );
        const finalEntry: LocationEntry = slug === entry.slug ? entry : { ...entry, slug };
        const isFirstLocation = config.locations.length === 0;
        const next: TuiConfig = {
          ...config,
          locations: [...config.locations, finalEntry],
        };
        if (isFirstLocation && config.default_location === undefined) {
          next.default_location = slug;
        }
        set({ config: next });
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          set({ lastActionError: errorMessage(e) });
        }
        get().switchLocation(slug);
      },

      completeOnboarding: async (entry: LocationEntry, units: TuiConfig["units"]) => {
        const config = get().config;
        if (config.locations.length > 0) {
          set({ lastActionError: "onboarding is already complete" });
          return false;
        }
        const slug = uniqueSlug(
          entry.slug,
          config.locations.map((loc) => loc.slug),
        );
        const finalEntry: LocationEntry = slug === entry.slug ? entry : { ...entry, slug };
        const next: TuiConfig = {
          ...config,
          units,
          default_location: slug,
          locations: [finalEntry],
        };
        set({ lastActionError: undefined });
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          set({ lastActionError: errorMessage(e) });
          return false;
        }
        set({ config: next, activeSlug: slug, lastActionError: undefined });
        await get().loadForecast(slug);
        scheduleRefreshLoop();
        return true;
      },

      deleteActiveLocation: async () => {
        const { config, activeSlug } = get();
        if (!activeSlug) return;
        const locations = config.locations;
        if (locations.length <= 1) {
          set({ lastActionError: "cannot delete the only location" });
          return;
        }
        const idx = locations.findIndex((loc) => loc.slug === activeSlug);
        if (idx === -1) return;
        const remaining = locations.filter((_, i) => i !== idx);
        const next: TuiConfig = { ...config, locations: remaining };
        if (config.default_location === activeSlug) {
          const fallback = remaining[0];
          if (fallback) {
            next.default_location = fallback.slug;
          } else {
            delete next.default_location;
          }
        }
        const nextActive = remaining[Math.min(idx, remaining.length - 1)];
        set({ config: next });
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          set({ lastActionError: errorMessage(e) });
        }
        if (nextActive) {
          get().switchLocation(nextActive.slug);
        } else {
          clearRefreshTimer();
          set({ activeSlug: null });
        }
      },

      dispose: () => {
        disposed = true;
        clearRefreshTimer();
      },
    };
  });
}

export type WeatherStore = ReturnType<typeof createStoreInstance>;

export const appStore: WeatherStore = createStoreInstance(prodDeps());
