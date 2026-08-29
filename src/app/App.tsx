import { useKeyboard, useRenderer } from "@opentui/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { DAYLIGHT_MIN_WIDTH, DaylightBar } from "../components/DaylightBar";
import { Sparkline } from "../components/Sparkline";
import { DetailsGrid } from "../features/current/DetailsGrid";
import { Hero } from "../features/current/Hero";
import { DailyList, dailyChips } from "../features/daily/DailyList";
import {
  HourlyStrip,
  MIN_WIDE_AREA_SERIES_WIDTH,
  sectionRule,
  seriesWidthFor,
  sliceUpcoming,
  TEMP_AREA_ROWS_NARROW,
  TEMP_AREA_ROWS_WIDE,
  windowIsDry,
} from "../features/hourly/HourlyStrip";
import { NowcastBanner } from "../features/nowcast/NowcastBanner";
import { FirstRun } from "../features/onboarding/FirstRun";
import { SearchOverlay } from "../features/search/SearchOverlay";
import type { DisplayPrefs, TuiConfig } from "../lib/config/schema";
import { resolveDisplayPrefs } from "../lib/config/schema";
import { conditionIcon } from "../lib/weather/condition-display";
import { deriveNowcast } from "../lib/weather/derive";
import { formatTemp, truncateCells } from "../lib/weather/format";
import type { AirQuality, NormalizedForecast } from "../lib/weather/types";
import { FALLBACK_APPEARANCE, type TerminalAppearance } from "../theme/detect";
import { buildPalette } from "../theme/palette";
import { ThemeContext, usePalette } from "../theme/tokens";
import type { Tier } from "../viewport/breakpoints";
import { useViewport } from "../viewport/useViewport";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { HelpOverlay } from "./components/HelpOverlay";
import { StatusArea } from "./components/StatusArea";
import { handleKey, type KeymapApi } from "./keymap";
import { appStore, isDeleteArmed, type WeatherStore } from "./store";

const SIDEBAR_WIDTH = 26;
/** Width budgeted for the slick-font hero digits when laying out the details grid beside it. */
const HERO_RESERVE = 22;

const EMPTY_FORECAST_HINT = "no forecast loaded — press r to refresh";
const SCROLL_HINT_MORE = "↓ more";

export let TICK_INTERVAL_MS = 30_000; // exported for tests to override ticker cadence
export function __setTickIntervalMs(ms: number) {
  TICK_INTERVAL_MS = ms;
}

const SLICK_HERO_ROWS = 7;
const COMPACT_HERO_ROWS = 2;
const DETAILS_GRID_ROWS = 4;
const NOWCAST_BANNER_ROWS = 2;
/** Error panel: border pair plus message and retry-hint rows. */
const ERROR_PANEL_ROWS = 4;
/** Hint line reserved under the scroll region when the overflow hint shows. */
const OVERFLOW_HINT_ROWS = 1;
/** Panel border pair plus the header/footer rows and their gaps around the main panel. */
export const MAIN_CHROME_ROWS = 6;
export interface MainOverflowInput {
  tier: Tier;
  width: number;
  forecast: NormalizedForecast;
  panels: TuiConfig["panels"];
  nowUtc: string;
}

function heroRowsFor(tier: Tier, panels: TuiConfig["panels"]): number {
  if (tier === "sm") return COMPACT_HERO_ROWS;
  if (tier === "md" && !panels.details) return COMPACT_HERO_ROWS;
  return Math.max(SLICK_HERO_ROWS, DETAILS_GRID_ROWS);
}

function hourlyRowsFor(
  tier: Tier,
  width: number,
  forecast: NormalizedForecast,
  panels: TuiConfig["panels"],
  nowUtc: string,
): number {
  if (!panels.hourly || width < 6) return 0;
  const maxPoints = tier === "sm" ? 12 : 48;
  const window = sliceUpcoming(forecast.hourly, nowUtc, maxPoints);
  if (window.length === 0) return 0;
  const seriesWidth = seriesWidthFor(window.length, width);
  const chartRows =
    seriesWidth < MIN_WIDE_AREA_SERIES_WIDTH ? TEMP_AREA_ROWS_NARROW : TEMP_AREA_ROWS_WIDE;
  const precipRows = windowIsDry(
    window.map((p) => p.precipMm),
    window.map((p) => p.precipProbabilityPct),
  )
    ? 0
    : 1;
  const detailRows =
    (tier === "md" || tier === "lg") &&
    window.some((p) => p.uvIndex !== null || p.humidityPct !== null || p.visibilityM !== null)
      ? 1
      : 0;
  return 1 + chartRows + precipRows + detailRows + 1;
}

/**
 * Conservative estimate of main-panel content rows (sections + inter-section
 * gaps). Null for xs, whose compact layout is sized to fit by construction.
 * Hourly height mirrors the area-chart block via its exported row constants.
 */
export function estimateMainContentRows(input: MainOverflowInput): number | null {
  const { tier, width, forecast, panels, nowUtc } = input;
  if (tier === "xs") return null;

  const sections: number[] = [heroRowsFor(tier, panels)];
  const today = forecast.daily[0];
  const sunriseMs = today?.sunriseUtc != null ? Date.parse(today.sunriseUtc) : NaN;
  const sunsetMs = today?.sunsetUtc != null ? Date.parse(today.sunsetUtc) : NaN;
  if (
    panels.details === true &&
    Number.isFinite(sunriseMs) &&
    Number.isFinite(sunsetMs) &&
    sunsetMs > sunriseMs &&
    width - 1 >= DAYLIGHT_MIN_WIDTH - 1
  ) {
    sections.push(1);
  }
  if (tier !== "lg" && panels.nowcast && deriveNowcast(forecast, nowUtc).kind !== "dry") {
    sections.push(NOWCAST_BANNER_ROWS);
  }
  const hourlyRows = hourlyRowsFor(tier, width, forecast, panels, nowUtc);
  if (hourlyRows > 0) sections.push(hourlyRows);
  if (panels.daily && forecast.daily.length > 0 && width >= 12) {
    sections.push(1);
    sections.push(tier === "lg" ? forecast.daily.length : Math.ceil(forecast.daily.length / 2));
  }

  const sectionRows = sections.reduce((sum, rows) => sum + rows, 0);
  return sectionRows + Math.max(0, sections.length - 1);
}

interface AppProps {
  store?: WeatherStore;
  initialSlug?: string;
  quit?: () => void;
  nowMs?: number;
  nowUtc?: string;
  appearance?: TerminalAppearance;
}

function truncateTo(text: string, width: number): string {
  return truncateCells(text, width);
}

function clampLine(label: string, width: number): string {
  if (width <= 1) return "";
  if (label.length <= width - 2) return `${label} …`;
  return `${label.slice(0, width - 1)}…`;
}

interface MainContentProps {
  tier: Tier;
  width: number;
  forecast: NormalizedForecast;
  nowUtc: string;
  prefs: DisplayPrefs;
  panels: TuiConfig["panels"];
  scrollHeight: number;
  airQuality?: AirQuality | null;
}

function XsChips({
  forecast,
  prefs,
  width,
}: {
  forecast: NormalizedForecast;
  prefs: DisplayPrefs;
  width: number;
}) {
  const palette = usePalette();
  return (
    <text fg={palette.fg}>
      {truncateTo(dailyChips(forecast.daily, prefs.temp), Math.max(0, width))}
    </text>
  );
}

function MainContent({
  tier,
  width,
  forecast,
  nowUtc,
  prefs,
  panels,
  scrollHeight,
  airQuality,
}: MainContentProps) {
  const palette = usePalette();
  const nowcast = deriveNowcast(forecast, nowUtc);
  const today = forecast.daily[0];
  const showDaylight =
    panels.details === true && today?.sunriseUtc != null && today?.sunsetUtc != null;

  if (tier === "xs") {
    const tempValues = sliceUpcoming(forecast.hourly, nowUtc, 12).map((p) => p.temperatureC);
    return (
      <box flexDirection="column" gap={1}>
        <Hero obs={forecast.current} prefs={prefs} mini />
        {panels.nowcast ? <NowcastBanner nowcast={nowcast} hideWhenDry width={width} /> : null}
        {panels.hourly && tempValues.length > 0 ? (
          <Sparkline
            values={tempValues}
            width={Math.min(tempValues.length, width)}
            palette={palette}
          />
        ) : null}
        {panels.daily ? <XsChips forecast={forecast} prefs={prefs} width={width} /> : null}
      </box>
    );
  }

  if (tier === "sm" || tier === "md") {
    const showDetails = tier === "md";
    return (
      <scrollbox
        height={scrollHeight}
        focused
        viewportCulling={false}
        scrollbarOptions={{ visible: false }}
      >
        <box flexDirection="column" gap={1}>
          {showDetails && panels.details ? (
            <box flexDirection="row" gap={2}>
              <Hero obs={forecast.current} prefs={prefs} />
              <DetailsGrid
                obs={forecast.current}
                today={forecast.daily[0]}
                utcOffsetSeconds={forecast.utcOffsetSeconds}
                prefs={prefs}
                colWidth={Math.max(10, Math.floor((width - HERO_RESERVE) / 2))}
                airQuality={airQuality}
              />
            </box>
          ) : (
            <Hero obs={forecast.current} prefs={prefs} compact />
          )}
          {showDaylight && today ? (
            <DaylightBar
              sunriseUtc={today.sunriseUtc}
              sunsetUtc={today.sunsetUtc}
              nowUtc={nowUtc}
              utcOffsetSeconds={forecast.utcOffsetSeconds}
              width={width}
              timeFormat={prefs.timeFormat}
            />
          ) : null}
          {panels.nowcast ? (
            <NowcastBanner
              nowcast={nowcast}
              hideWhenDry
              width={width}
              forecast={forecast}
              nowUtc={nowUtc}
            />
          ) : null}
          {panels.hourly ? (
            <HourlyStrip
              points={forecast.hourly}
              nowUtc={nowUtc}
              utcOffsetSeconds={forecast.utcOffsetSeconds}
              prefs={prefs}
              maxPoints={showDetails ? 48 : 12}
              width={width}
              showDetail={showDetails}
            />
          ) : null}
          {panels.daily ? (
            <>
              <text fg={palette.fgDim}>{sectionRule(`${forecast.daily.length} day`, width)}</text>
              <DailyList
                days={forecast.daily}
                prefs={prefs}
                columns={2}
                width={width}
                showPrecip={!showDetails}
              />
            </>
          ) : null}
        </box>
      </scrollbox>
    );
  }

  return (
    <scrollbox
      height={scrollHeight}
      focused
      viewportCulling={false}
      scrollbarOptions={{ visible: false }}
    >
      <box flexDirection="column" gap={1}>
        <box flexDirection="row" gap={2}>
          <Hero obs={forecast.current} prefs={prefs} />
          {panels.details ? (
            <DetailsGrid
              obs={forecast.current}
              today={forecast.daily[0]}
              utcOffsetSeconds={forecast.utcOffsetSeconds}
              prefs={prefs}
              colWidth={Math.max(10, Math.floor((width - HERO_RESERVE) / 2))}
              airQuality={airQuality}
            />
          ) : null}
        </box>
        {showDaylight && today ? (
          <DaylightBar
            sunriseUtc={today.sunriseUtc}
            sunsetUtc={today.sunsetUtc}
            nowUtc={nowUtc}
            utcOffsetSeconds={forecast.utcOffsetSeconds}
            width={width}
            timeFormat={prefs.timeFormat}
          />
        ) : null}
        {panels.hourly ? (
          <HourlyStrip
            points={forecast.hourly}
            nowUtc={nowUtc}
            utcOffsetSeconds={forecast.utcOffsetSeconds}
            prefs={prefs}
            maxPoints={48}
            width={width}
            showDetail
          />
        ) : null}
        {panels.daily ? (
          <>
            <text fg={palette.fgDim}>{sectionRule(`${forecast.daily.length} day`, width)}</text>
            <DailyList days={forecast.daily} prefs={prefs} columns={1} width={width} />
          </>
        ) : null}
      </box>
    </scrollbox>
  );
}

export function App(props: AppProps = {}) {
  const store = props.store ?? appStore;
  const initStatus = store((s) => s.initStatus);
  const config = store((s) => s.config);
  const activeSlug = store((s) => s.activeSlug);
  const entry = store((s) => (activeSlug === null ? undefined : s.forecastBySlug[activeSlug]));
  const loading = store((s) =>
    activeSlug === null ? false : (s.loadingSlugs[activeSlug] ?? false),
  );
  const error = store((s) => (activeSlug === null ? undefined : s.errorBySlug[activeSlug]));
  const stale = store((s) => (activeSlug === null ? false : (s.staleBySlug[activeSlug] ?? false)));
  const helpOpen = store((s) => s.helpOpen);
  const overlayOpen = store((s) => s.overlayOpen);
  const forecastBySlug = store((s) => s.forecastBySlug);
  const airQuality = store((s) => s.airQuality);
  const lastActionError = store((s) => s.lastActionError);
  const deleteArmedAtMs = store((s) => s.deleteArmedAtMs);

  const viewport = useViewport();
  const renderer = useRenderer();

  const isDay = entry?.forecast.current.isDay ?? true;
  const appearance = props.appearance ?? FALLBACK_APPEARANCE;
  const palette = useMemo(
    () => buildPalette(config.theme, isDay, appearance.ink, appearance.background),
    [config.theme, isDay, appearance],
  );
  const prefs = useMemo(() => resolveDisplayPrefs(config), [config]);

  useEffect(() => {
    void store.getState().init(props.initialSlug);
  }, [store, props.initialSlug]);

  useEffect(() => {
    return () => {
      store.getState().dispose();
    };
  }, [store]);

  const quit = props.quit ?? (() => renderer.destroy());
  const activeLocation =
    activeSlug === null ? undefined : config.locations.find((loc) => loc.slug === activeSlug);
  const label = activeLocation?.label ?? "tuiweather";
  const [, setTick] = useState(0);
  useEffect(() => {
    if (props.nowMs !== undefined) return;
    const h = setInterval(() => setTick((v) => v + 1), TICK_INTERVAL_MS);
    h.unref?.();
    return () => clearInterval(h);
  }, [props.nowMs]);
  const nowMs = props.nowMs ?? Date.now();
  const nowUtc = props.nowUtc ?? new Date(nowMs).toISOString();
  const tier = viewport.tier;
  const forecast = entry?.forecast;
  const onboardingOpen = initStatus === "ready" && config.locations.length === 0;
  const deleteArmed = isDeleteArmed(deleteArmedAtMs, nowMs);

  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  useEffect(() => {
    if (tier !== "lg") setFocusedSlug(null);
    else if (focusedSlug !== null && !config.locations.some((loc) => loc.slug === focusedSlug)) {
      setFocusedSlug(null);
    }
  }, [config.locations, focusedSlug, tier]);

  const api = useMemo<KeymapApi>(
    () => ({
      quit,
      activeSlug: () => store.getState().activeSlug,
      refresh: (slug) => void store.getState().refresh(slug),
      cycleLocation: (delta) => store.getState().cycleLocation(delta),
      toggleUnits: () => void store.getState().toggleUnits(),
      helpOpen: () => store.getState().helpOpen,
      toggleHelp: () => store.getState().toggleHelp(),
      searchOpen: () => {
        const state = store.getState();
        return (
          state.overlayOpen || (state.initStatus === "ready" && state.config.locations.length === 0)
        );
      },
      openSearch: () => store.getState().setOverlayOpen(true),
      deleteArmed: () => store.getState().deleteArmed(Date.now()),
      armDelete: () => store.getState().armDelete(),
      disarmDelete: () => store.getState().disarmDelete(),
      deleteActive: () => void store.getState().deleteActiveLocation(),
      locations: () => store.getState().config.locations.map((loc) => loc.slug),
      switchLocation: (slug) => store.getState().switchLocation(slug),
      focusedSlug: () => focusedSlug,
      setFocused: (slug) => setFocusedSlug(slug),
      isLg: () => tier === "lg",
      setDefault: (slug) => void store.getState().setDefaultLocation(slug),
      moveLocation: (slug, delta) => void store.getState().moveLocation(slug, delta),
    }),
    [store, quit, focusedSlug, tier],
  );

  useKeyboard((key) => {
    handleKey(key, api);
  });

  const header = (
    <Header
      label={label}
      coords={
        activeLocation
          ? { latitude: activeLocation.latitude, longitude: activeLocation.longitude }
          : undefined
      }
      clockUtc={entry?.forecast.current.timeUtc}
      utcOffsetSeconds={entry?.forecast.utcOffsetSeconds ?? 0}
      timeFormat={prefs.timeFormat}
      tier={tier === "lg" || tier === "md" ? undefined : tier}
      fetchedAtMs={entry?.fetchedAtMs}
      stale={stale}
      nowMs={nowMs}
    />
  );

  const staleBadge = stale && !loading && error === undefined;

  const status = (
    <StatusArea
      loading={loading}
      error={error}
      stale={staleBadge}
      deleteArm={deleteArmed ? { label } : undefined}
      width={viewport.width}
    />
  );

  const footer = <Footer tier={tier} />;

  const mainWidth = tier === "lg" ? viewport.width - SIDEBAR_WIDTH - 4 : viewport.width - 4;

  const forecastVisible = forecast !== undefined && !helpOpen && !overlayOpen;
  const overflowEstimate =
    forecastVisible && forecast
      ? estimateMainContentRows({
          tier,
          width: mainWidth,
          forecast,
          panels: config.panels,
          nowUtc,
        })
      : null;
  const statusRows = deleteArmed
    ? 1
    : loading
      ? 1
      : error !== undefined
        ? ERROR_PANEL_ROWS
        : staleBadge
          ? 1
          : 0;
  const statusBlock = statusRows > 0 ? statusRows + 1 : 0;
  const showOverflowHint =
    overflowEstimate !== null &&
    viewport.height < overflowEstimate + MAIN_CHROME_ROWS + statusBlock;
  const mainScrollHeight = Math.max(
    1,
    viewport.height - MAIN_CHROME_ROWS - statusBlock - (showOverflowHint ? OVERFLOW_HINT_ROWS : 0),
  );

  const mainView =
    forecast !== undefined && !helpOpen && !overlayOpen ? (
      <MainContent
        tier={tier}
        width={mainWidth}
        forecast={forecast}
        nowUtc={nowUtc}
        prefs={prefs}
        panels={config.panels}
        scrollHeight={mainScrollHeight}
        airQuality={airQuality}
      />
    ) : (
      <text fg={palette.fgDim}>{truncateTo(EMPTY_FORECAST_HINT, Math.max(0, mainWidth - 1))}</text>
    );

  const mainPanel = (
    <box
      border
      borderColor={palette.border}
      flexGrow={1}
      title="main"
      flexDirection="column"
      paddingX={1}
    >
      {mainView}
      {showOverflowHint ? (
        <box flexDirection="row" justifyContent="flex-end">
          <text fg={palette.fgDim}>{SCROLL_HINT_MORE}</text>
        </box>
      ) : null}
    </box>
  );

  let body: ReactNode;
  if (viewport.clamped) {
    body = (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <text fg={palette.fg}>{clampLine(label, viewport.width)}</text>
      </box>
    );
  } else if (tier === "lg") {
    body = (
      <box flexDirection="row" flexGrow={1}>
        <box
          width={SIDEBAR_WIDTH}
          border
          borderColor={palette.border}
          title="locations"
          flexDirection="column"
        >
          {config.locations.map((loc) => {
            const locEntry = forecastBySlug[loc.slug];
            const isFocused = loc.slug === focusedSlug;
            const isActive = loc.slug === activeSlug;
            const bullet = isFocused ? "▸" : isActive ? "●" : "○";
            const fg = isFocused
              ? isActive
                ? palette.accent
                : palette.fg
              : isActive
                ? palette.accent
                : palette.fgDim;
            const tail = locEntry
              ? ` ${conditionIcon(locEntry.forecast.current.condition)} ${formatTemp(
                  locEntry.forecast.current.temperatureC,
                  prefs.temp,
                )}`
              : "";
            return (
              <text key={loc.slug} fg={fg}>
                {truncateTo(`${bullet} ${loc.label}${tail}`, SIDEBAR_WIDTH - 2)}
              </text>
            );
          })}
        </box>
        <box flexDirection="column" flexGrow={1} gap={1}>
          {header}
          {status}
          {mainPanel}
          {footer}
        </box>
      </box>
    );
  } else {
    body = (
      <box flexDirection="column" flexGrow={1} gap={1}>
        {header}
        {status}
        {mainPanel}
        {footer}
      </box>
    );
  }

  return (
    <ThemeContext value={palette}>
      <box flexDirection="column" width="100%" height="100%">
        {initStatus === "idle" || initStatus === "loading" ? (
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={palette.fgDim}>starting tuiweather…</text>
          </box>
        ) : initStatus === "error" ? (
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={palette.danger}>
              {truncateTo(lastActionError ?? "could not load config", Math.max(1, viewport.width))}
            </text>
          </box>
        ) : onboardingOpen ? (
          <FirstRun store={store} width={viewport.width} height={viewport.height} quit={quit} />
        ) : (
          <>
            {body}
            {helpOpen ? (
              <HelpOverlay
                width={viewport.width}
                height={viewport.height}
                providerLabel={config.provider === "nws" ? "api.weather.gov" : "open-meteo.com"}
              />
            ) : null}
            {overlayOpen ? (
              <SearchOverlay store={store} width={viewport.width} height={viewport.height} />
            ) : null}
          </>
        )}
      </box>
    </ThemeContext>
  );
}
