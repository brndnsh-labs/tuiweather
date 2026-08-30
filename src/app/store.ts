import {
  clearInterval as timersClearInterval,
  setInterval as timersSetInterval,
} from "node:timers";
import { create } from "zustand";
import { uniqueSlug } from "../features/search/SearchOverlay";
import { loadConfig } from "../lib/config/load";
import { saveConfig } from "../lib/config/save";
import { DEFAULT_CONFIG, resolveDisplayPrefs, type TuiConfig } from "../lib/config/schema";
import { searchLocations as geocodeLocations } from "../lib/providers/openmeteo/geocoding";
import { selectProvider } from "../lib/providers/select";
import type { ForecastWindow, GeocodingResult, ProviderId } from "../lib/providers/types";
import { cachedAirQuality, cachedForecast } from "../lib/weather/cache";
import type { AirQuality, GeoPoint, NormalizedForecast } from "../lib/weather/types";

export type ForecastFetcher = (
  location: GeoPoint,
  opts: { maxAgeMinutes: number; window: ForecastWindow; provider?: ProviderId },
) => Promise<{
  forecast: NormalizedForecast;
  stale: boolean;
}>;

export type AirQualityFetcher = (
  location: GeoPoint,
  opts?: { nowUtc?: string; provider?: ProviderId },
) => Promise<AirQuality>;

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

/**
 * Cache freshness is compared inclusively at `refresh_minutes`, so a loop
 * scheduled at exactly the TTL can be served its own cache entry when a tick
 * fires a hair early. Pads the period below the TTL so every tick refetches.
 */
export const REFRESH_LOOP_MARGIN_MS = 30_000;
export const MIN_REFRESH_LOOP_PERIOD_MS = 60_000;

export function refreshLoopPeriodMs(refreshMinutes: number): number {
  return Math.max(MIN_REFRESH_LOOP_PERIOD_MS, refreshMinutes * 60_000 - REFRESH_LOOP_MARGIN_MS);
}

export interface ForecastEntry {
  forecast: NormalizedForecast;
  fetchedAtMs: number;
}

export interface StoreDeps {
  configPath?: string;
  fetchForecast: ForecastFetcher;
  fetchAirQuality: AirQualityFetcher;
  searchLocations?: SearchLocationsFn;
  refreshTimers?: RefreshTimerDeps;
}

export const defaultFetcher: ForecastFetcher = (location, opts) =>
  cachedForecast(selectProvider(opts.provider ?? "openmeteo"), location, {
    maxAgeMinutes: opts.maxAgeMinutes,
    window: opts.window,
  });

export const defaultAirQualityFetcher: AirQualityFetcher = (location, opts) =>
  cachedAirQuality(selectProvider(opts?.provider ?? "openmeteo"), location, opts).then(
    (r) => r.airQuality,
  );

export const defaultSearchLocations: SearchLocationsFn = (query) => geocodeLocations(query);

export function prodDeps(): Pick<StoreDeps, "fetchForecast" | "fetchAirQuality"> {
  return { fetchForecast: defaultFetcher, fetchAirQuality: defaultAirQualityFetcher };
}

/** Armed delete expires lazily after this long; no timers involved. */
export const DELETE_ARM_TTL_MS = 4000;

export function isDeleteArmed(armedAtMs: number | null, nowMs: number): boolean {
  return armedAtMs !== null && nowMs >= armedAtMs && nowMs - armedAtMs < DELETE_ARM_TTL_MS;
}

export const ACTION_ERROR_TTL_MS = DELETE_ARM_TTL_MS;

export function isActionErrorActive(atMs: number | null, nowMs: number): boolean {
  return atMs !== null && nowMs >= atMs && nowMs - atMs < ACTION_ERROR_TTL_MS;
}

export interface WeatherState {
  initStatus: "idle" | "loading" | "ready" | "error";
  config: TuiConfig;
  activeSlug: string | null;
  forecastBySlug: Record<string, ForecastEntry>;
  loadingSlugs: Record<string, true>;
  errorBySlug: Record<string, string>;
  staleBySlug: Record<string, boolean>;
  airQuality: AirQuality | null;
  airQualityBySlug: Record<string, AirQuality>;
  lastActionError: string | undefined;
  lastActionErrorAtMs: number | null;
  helpOpen: boolean;
  overlayOpen: boolean;
  locationsOpen: boolean;
  deleteArmedAtMs: number | null;
  onboardingSkipped: boolean;
  onboardingForced: boolean;

  init(explicitSlug?: string): Promise<void>;
  loadForecast(slug: string, opts?: { bypassCache?: boolean }): Promise<void>;
  refresh(slug: string | null): Promise<void>;
  switchLocation(slug: string): void;
  cycleLocation(delta: 1 | -1): void;
  toggleUnits(): Promise<void>;
  toggleHelp(): void;
  setOverlayOpen(open: boolean): void;
  setLocationsOpen(open: boolean): void;
  armDelete(): void;
  disarmDelete(): void;
  clearActionError(): void;
  deleteArmed(nowMs: number): boolean;
  searchLocations(query: string): Promise<GeocodingResult[]>;
  addLocation(entry: LocationEntry): Promise<boolean>;
  completeOnboarding(entry: LocationEntry, units: TuiConfig["units"]): Promise<boolean>;
  deleteActiveLocation(): Promise<void>;
  deleteLocation(slug: string): Promise<void>;
  setDefaultLocation(slug: string): Promise<void>;
  moveLocation(slug: string, delta: 1 | -1): Promise<void>;
  skipOnboarding(): void;
  requestOnboarding(): void;
  dispose(): void;
}

function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.split("\n")[0] ?? raw;
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
  const fetcher = deps.fetchForecast;
  const aqFetcher = deps.fetchAirQuality;
  const geocoder = deps.searchLocations ?? defaultSearchLocations;
  const timerDeps = deps.refreshTimers ?? DEFAULT_REFRESH_TIMERS;

  return create<WeatherState>()((set, get) => {
    let refreshHandle: unknown;
    let disposed = false;
    const inFlight = new Map<string, Promise<void>>();
    let actionErrorTimer: ReturnType<typeof setTimeout> | undefined;

    function clearActionErrorTimer(): void {
      if (actionErrorTimer !== undefined) {
        clearTimeout(actionErrorTimer);
        actionErrorTimer = undefined;
      }
    }

    function clearActionErrorState(): void {
      clearActionErrorTimer();
      const s = get();
      if (s.lastActionError !== undefined || s.lastActionErrorAtMs !== null) {
        set({ lastActionError: undefined, lastActionErrorAtMs: null });
      }
    }

    function setActionErrorState(message: string): void {
      clearActionErrorTimer();
      const now = Date.now();
      const flat = message.replace(/\s+/g, " ").trim();
      set({ lastActionError: flat, lastActionErrorAtMs: now });
      actionErrorTimer = setTimeout(() => {
        if (disposed) return;
        const cur = get();
        if (cur.lastActionErrorAtMs === now) {
          set({ lastActionError: undefined, lastActionErrorAtMs: null });
        }
        actionErrorTimer = undefined;
      }, ACTION_ERROR_TTL_MS);
      (actionErrorTimer as unknown as { unref?: () => void }).unref?.();
    }

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
      }, refreshLoopPeriodMs(get().config.refresh_minutes));
    }

    function launchAirQuality(slug: string, location: GeoPoint, provider: ProviderId): void {
      void (async () => {
        try {
          const aq = await aqFetcher(location, { provider });
          if (disposed) return;
          set((s) => {
            const nextBySlug = { ...s.airQualityBySlug, [slug]: aq };
            if (s.activeSlug === slug) return { airQuality: aq, airQualityBySlug: nextBySlug };
            return { airQualityBySlug: nextBySlug };
          });
        } catch {
          if (disposed) return;
          set((s) => {
            if (s.activeSlug === slug) {
              const nextBySlug = { ...s.airQualityBySlug };
              delete nextBySlug[slug];
              return { airQuality: null, airQualityBySlug: nextBySlug };
            }
            const nextBySlug = { ...s.airQualityBySlug };
            delete nextBySlug[slug];
            return { airQualityBySlug: nextBySlug };
          });
        }
      })();
    }

    return {
      initStatus: "idle",
      config: DEFAULT_CONFIG,
      activeSlug: null,
      forecastBySlug: {},
      loadingSlugs: {},
      errorBySlug: {},
      staleBySlug: {},
      airQuality: null,
      airQualityBySlug: {},
      lastActionError: undefined,
      lastActionErrorAtMs: null,
      helpOpen: false,
      overlayOpen: false,
      locationsOpen: false,
      deleteArmedAtMs: null,
      onboardingSkipped: false,
      onboardingForced: false,

      init: async (explicitSlug?: string) => {
        clearActionErrorTimer();
        set({ initStatus: "loading", lastActionError: undefined, lastActionErrorAtMs: null });
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
          clearActionErrorTimer();
          set({ initStatus: "error", lastActionError: errorMessage(e), lastActionErrorAtMs: null });
        }
      },

      loadForecast: async (slug: string, opts?: { bypassCache?: boolean }) => {
        const pending = inFlight.get(slug);
        if (pending) return pending;
        const load = (async () => {
          const state = get();
          const location = findLocation(state.config, slug);
          if (!location) {
            set((s) => ({
              errorBySlug: { ...s.errorBySlug, [slug]: `unknown location "${slug}"` },
            }));
            return;
          }
          set((s) => ({ loadingSlugs: { ...s.loadingSlugs, [slug]: true as const } }));
          launchAirQuality(
            slug,
            { latitude: location.latitude, longitude: location.longitude },
            state.config.provider,
          );
          try {
            const result = await fetcher(
              { latitude: location.latitude, longitude: location.longitude },
              {
                maxAgeMinutes: opts?.bypassCache === true ? 0 : get().config.refresh_minutes,
                provider: state.config.provider,
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
            inFlight.delete(slug);
          }
        })();
        inFlight.set(slug, load);
        return load;
      },

      refresh: async (slug: string | null) => {
        if (!slug || !findLocation(get().config, slug)) return;
        await get().loadForecast(slug, { bypassCache: true });
      },

      switchLocation: (slug: string) => {
        if (!findLocation(get().config, slug)) return;
        clearActionErrorState();
        const aq = get().airQualityBySlug[slug] ?? null;
        set({ activeSlug: slug, airQuality: aq });
        scheduleRefreshLoop();
        void get().loadForecast(slug);
      },

      cycleLocation: (delta: 1 | -1) => {
        clearActionErrorState();
        set({ deleteArmedAtMs: null });
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
        const prefs = resolveDisplayPrefs(config);
        const mixed = new Set([prefs.temp, prefs.wind, prefs.precip, prefs.pressure]).size > 1;
        const units: TuiConfig["units"] = config.units === "metric" ? "imperial" : "metric";
        const next: TuiConfig = mixed
          ? { ...config, units, unit_prefs: { ...config.unit_prefs, temp: units } }
          : {
              ...config,
              units,
              unit_prefs: { temp: units, wind: units, precip: units, pressure: units },
            };
        clearActionErrorState();
        set({ config: next });
        await saveConfig(next, deps.configPath).catch((e: unknown) => {
          setActionErrorState(errorMessage(e));
        });
      },

      toggleHelp: () => {
        clearActionErrorState();
        set((s) => ({ helpOpen: !s.helpOpen }));
      },

      setOverlayOpen: (open: boolean) => {
        clearActionErrorState();
        set(
          open
            ? { overlayOpen: true, locationsOpen: false, deleteArmedAtMs: null }
            : { overlayOpen: false },
        );
      },

      setLocationsOpen: (open: boolean) => {
        clearActionErrorState();
        set(
          open
            ? { locationsOpen: true, overlayOpen: false, deleteArmedAtMs: null }
            : { locationsOpen: false },
        );
      },

      armDelete: () => {
        clearActionErrorState();
        set({ deleteArmedAtMs: Date.now() });
      },

      disarmDelete: () => {
        clearActionErrorState();
        set({ deleteArmedAtMs: null });
      },

      clearActionError: () => {
        clearActionErrorState();
      },

      deleteArmed: (nowMs: number) => isDeleteArmed(get().deleteArmedAtMs, nowMs),

      searchLocations: (query: string) => geocoder(query),

      addLocation: async (entry: LocationEntry) => {
        clearActionErrorState();
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
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          setActionErrorState(errorMessage(e));
          return false;
        }
        set({ config: next });
        get().switchLocation(slug);
        clearActionErrorState();
        return true;
      },

      completeOnboarding: async (entry: LocationEntry, units: TuiConfig["units"]) => {
        const config = get().config;
        const forced = get().onboardingForced;
        if (config.locations.length > 0 && !forced) {
          setActionErrorState("onboarding is already complete");
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
          unit_prefs: { temp: units, wind: units, precip: units, pressure: units },
          default_location: slug,
          locations:
            forced && config.locations.length > 0
              ? [...config.locations, finalEntry]
              : [finalEntry],
        };
        clearActionErrorState();
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          setActionErrorState(errorMessage(e));
          return false;
        }
        clearActionErrorState();
        set({
          config: next,
          activeSlug: slug,
          onboardingForced: false,
          onboardingSkipped: false,
        });
        await get().loadForecast(slug);
        scheduleRefreshLoop();
        return true;
      },

      deleteActiveLocation: async () => {
        const slug = get().activeSlug;
        if (!slug) return;
        await get().deleteLocation(slug);
      },

      deleteLocation: async (slug: string) => {
        const config = get().config;
        set({ deleteArmedAtMs: null });
        const locations = config.locations;
        if (locations.length <= 1) {
          setActionErrorState("cannot delete the only location");
          return;
        }
        clearActionErrorState();
        const idx = locations.findIndex((loc) => loc.slug === slug);
        if (idx === -1) return;
        const remaining = locations.filter((_, i) => i !== idx);
        const next: TuiConfig = { ...config, locations: remaining };
        if (config.default_location === slug) {
          const fallback = remaining[0];
          if (fallback) {
            next.default_location = fallback.slug;
          } else {
            delete next.default_location;
          }
        }
        const nextActive = remaining[Math.min(idx, remaining.length - 1)];
        set((s) => ({
          config: next,
          airQualityBySlug: withoutKey(s.airQualityBySlug, slug),
        }));
        let saveError: string | undefined;
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          saveError = errorMessage(e);
        }
        if (slug === get().activeSlug) {
          if (nextActive) {
            get().switchLocation(nextActive.slug);
          } else {
            clearRefreshTimer();
            set({ activeSlug: null, airQuality: null });
          }
        }
        if (saveError !== undefined) setActionErrorState(saveError);
      },

      setDefaultLocation: async (slug: string) => {
        const config = get().config;
        if (!findLocation(config, slug)) return;
        clearActionErrorState();
        const next: TuiConfig = { ...config, default_location: slug };
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          setActionErrorState(errorMessage(e));
          return;
        }
        set({ config: next });
        clearActionErrorState();
      },

      moveLocation: async (slug: string, delta: 1 | -1) => {
        const config = get().config;
        const idx = config.locations.findIndex((loc) => loc.slug === slug);
        if (idx === -1) return;
        const nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= config.locations.length) return;
        clearActionErrorState();
        const nextLocations = [...config.locations];
        const [moved] = nextLocations.splice(idx, 1);
        if (!moved) return;
        nextLocations.splice(nextIdx, 0, moved);
        const next: TuiConfig = { ...config, locations: nextLocations };
        try {
          await saveConfig(next, deps.configPath);
        } catch (e) {
          setActionErrorState(errorMessage(e));
          return;
        }
        set({ config: next });
        clearActionErrorState();
      },

      skipOnboarding: () => set({ onboardingSkipped: true, onboardingForced: false }),

      requestOnboarding: () =>
        set({
          onboardingSkipped: false,
          onboardingForced: true,
          helpOpen: false,
          overlayOpen: false,
          locationsOpen: false,
        }),

      dispose: () => {
        disposed = true;
        clearRefreshTimer();
        clearActionErrorTimer();
        set({ airQuality: null, airQualityBySlug: {} });
        inFlight.clear();
      },
    };
  });
}

export type WeatherStore = ReturnType<typeof createStoreInstance>;

export const appStore: WeatherStore = createStoreInstance(prodDeps());
