import { useKeyboard, useRenderer } from "@opentui/react";
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { DAYLIGHT_MIN_WIDTH, DaylightBar } from "../components/DaylightBar";
import { Sparkline } from "../components/Sparkline";
import { DetailsGrid } from "../features/current/DetailsGrid";
import { Hero } from "../features/current/Hero";
import {
  clampDailyPageIndex,
  DAILY_PAGE_SIZE,
  DailyList,
  dailyChips,
  dailySectionLabel,
} from "../features/daily/DailyList";
import { DayDetailOverlay, localDateAtOffset } from "../features/daydetail/DayDetailOverlay";
import {
  HourlyStrip,
  MIN_WIDE_AREA_SERIES_WIDTH,
  nextInspectTimeUtc,
  sectionRule,
  seriesWidthFor,
  sliceUpcoming,
  TEMP_AREA_ROWS_NARROW,
  TEMP_AREA_ROWS_WIDE,
  windowIsDry,
} from "../features/hourly/HourlyStrip";
import { LocationsOverlay } from "../features/locations/LocationsOverlay";
import { NowcastBanner } from "../features/nowcast/NowcastBanner";
import { FirstRun } from "../features/onboarding/FirstRun";
import { SearchOverlay } from "../features/search/SearchOverlay";
import type { DisplayPrefs, TuiConfig } from "../lib/config/schema";
import { resolveDisplayPrefs } from "../lib/config/schema";
import { deriveNowcast } from "../lib/weather/derive";
import { displayWidth, truncateCells } from "../lib/weather/format";
import type { AirQuality, NormalizedForecast } from "../lib/weather/types";
import { FALLBACK_APPEARANCE, type TerminalAppearance } from "../theme/detect";
import { buildPalette } from "../theme/palette";
import { ThemeContext, usePalette } from "../theme/tokens";
import type { Tier } from "../viewport/breakpoints";
import { useViewport } from "../viewport/useViewport";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { HelpOverlay } from "./components/HelpOverlay";
import { SIDEBAR_WIDTH, Sidebar } from "./components/Sidebar";
import { StatusArea } from "./components/StatusArea";
import { useNowMs } from "./hooks/useNowMs";
import { handleKey, type KeymapApi } from "./keymap";
import { appStore, isActionErrorActive, isDeleteArmed, type WeatherStore } from "./store";

export { __setTickIntervalMs, TICK_INTERVAL_MS } from "./tick";

/** Width budgeted for the slick-font hero digits when laying out the details grid beside it. */
const HERO_RESERVE = 22;

const EMPTY_FORECAST_HINT = "no forecast loaded — press r to refresh";
const SCROLL_HINT_MORE = "↓ more";

const SLICK_HERO_ROWS = 7;
const COMPACT_HERO_ROWS = 2;
const DETAILS_GRID_ROWS = 4;
const NOWCAST_BANNER_ROWS = 2;
/** Extra rows the toggled minutely-15 expansion adds under the banner: a labeled bar row + a time-tick row. */
const NOWCAST_EXPANSION_ROWS = 2;
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
  hourlyInspectTimeUtc?: string | null;
  nowcastExpanded?: boolean;
}

function heroRowsFor(tier: Tier, panels: TuiConfig["panels"]): number {
  if (tier === "sm") return COMPACT_HERO_ROWS;
  if (tier === "md" && !panels.details) return COMPACT_HERO_ROWS;
  return Math.max(SLICK_HERO_ROWS, DETAILS_GRID_ROWS);
}

/** Single source of truth for the hourly window size per tier — mirrors the maxPoints passed to every <HourlyStrip>. */
function hourlyWindowMaxPoints(tier: Tier): number {
  return tier === "sm" ? 12 : 48;
}

function hourlyRowsFor(
  tier: Tier,
  width: number,
  forecast: NormalizedForecast,
  panels: TuiConfig["panels"],
  nowUtc: string,
  hourlyInspectTimeUtc: string | null,
): number {
  if (!panels.hourly || width < 6) return 0;
  const maxPoints = hourlyWindowMaxPoints(tier);
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
  const inspectRows =
    hourlyInspectTimeUtc !== null && window.some((p) => p.timeUtc === hourlyInspectTimeUtc) ? 1 : 0;
  return 1 + chartRows + precipRows + detailRows + inspectRows + 1;
}

/**
 * Conservative estimate of main-panel content rows (sections + inter-section
 * gaps). Null for xs, whose compact layout is sized to fit by construction.
 * Hourly height mirrors the area-chart block via its exported row constants.
 */
export function estimateMainContentRows(input: MainOverflowInput): number | null {
  const {
    tier,
    width,
    forecast,
    panels,
    nowUtc,
    hourlyInspectTimeUtc = null,
    nowcastExpanded = false,
  } = input;
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
  const nowcastKind = deriveNowcast(forecast, nowUtc).kind;
  if (tier !== "lg" && panels.nowcast && nowcastKind !== "dry" && nowcastKind !== "unavailable") {
    sections.push(NOWCAST_BANNER_ROWS + (nowcastExpanded ? NOWCAST_EXPANSION_ROWS : 0));
  }
  const hourlyRows = hourlyRowsFor(tier, width, forecast, panels, nowUtc, hourlyInspectTimeUtc);
  if (hourlyRows > 0) sections.push(hourlyRows);
  if (panels.daily && forecast.daily.length > 0 && width >= 12) {
    sections.push(1);
    const pageDays = Math.min(forecast.daily.length, DAILY_PAGE_SIZE);
    sections.push(tier === "lg" ? pageDays : Math.ceil(pageDays / 2));
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
  if (displayWidth(label) <= width - 2) return `${label} …`;
  return `${truncateCells(label, width - 2)} …`;
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
  selectedDayDateLocal: string | null;
  dailyPageIndex: number;
  hourlyInspectTimeUtc: string | null;
  nowcastExpanded: boolean;
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

const MainContent = memo(function MainContent({
  tier,
  width,
  forecast,
  nowUtc,
  prefs,
  panels,
  scrollHeight,
  airQuality,
  selectedDayDateLocal,
  dailyPageIndex,
  hourlyInspectTimeUtc,
  nowcastExpanded,
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
              expanded={nowcastExpanded}
              timeFormat={prefs.timeFormat}
            />
          ) : null}
          {panels.hourly ? (
            <HourlyStrip
              points={forecast.hourly}
              nowUtc={nowUtc}
              utcOffsetSeconds={forecast.utcOffsetSeconds}
              prefs={prefs}
              maxPoints={hourlyWindowMaxPoints(tier)}
              width={width}
              showDetail={showDetails}
              inspectTimeUtc={hourlyInspectTimeUtc}
            />
          ) : null}
          {panels.daily ? (
            <>
              <text fg={palette.fgDim}>
                {sectionRule(dailySectionLabel(forecast.daily.length, dailyPageIndex), width)}
              </text>
              <DailyList
                days={forecast.daily}
                pageIndex={dailyPageIndex}
                prefs={prefs}
                width={width}
                showPrecip={!showDetails}
                selectedDateLocal={selectedDayDateLocal}
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
            maxPoints={hourlyWindowMaxPoints(tier)}
            width={width}
            showDetail
            inspectTimeUtc={hourlyInspectTimeUtc}
          />
        ) : null}
        {panels.daily ? (
          <>
            <text fg={palette.fgDim}>
              {sectionRule(dailySectionLabel(forecast.daily.length, dailyPageIndex), width)}
            </text>
            <DailyList
              days={forecast.daily}
              pageIndex={dailyPageIndex}
              prefs={prefs}
              width={width}
              selectedDateLocal={selectedDayDateLocal}
            />
          </>
        ) : null}
      </box>
    </scrollbox>
  );
});

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
  const locationsOpen = store((s) => s.locationsOpen);
  const dayCursorDate = store((s) => s.dayCursorDate);
  const dayDetailDate = store((s) => s.dayDetailDate);
  const dailyPageIndex = store((s) => s.dailyPageIndex);
  const hourlyInspectTimeUtc = store((s) => s.hourlyInspectTimeUtc);
  const nowcastExpanded = store((s) => s.nowcastExpanded);
  const airQuality = store((s) => s.airQuality);
  const lastActionError = store((s) => s.lastActionError);
  const lastActionErrorAtMs = store((s) => s.lastActionErrorAtMs);
  const deleteArmedAtMs = store((s) => s.deleteArmedAtMs);
  const onboardingSkipped = store((s) => s.onboardingSkipped);
  const onboardingForced = store((s) => s.onboardingForced);

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
  const nowMs = useNowMs(props.nowMs);
  const nowUtc = props.nowUtc ?? new Date(nowMs).toISOString();
  const tier = viewport.tier;
  const forecast = entry?.forecast;
  const onboardingOpen =
    initStatus === "ready" &&
    ((config.locations.length === 0 && !onboardingSkipped) || onboardingForced);
  const deleteArmed = isDeleteArmed(deleteArmedAtMs, nowMs);
  const actionError = isActionErrorActive(lastActionErrorAtMs, Date.now())
    ? lastActionError
    : undefined;

  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  useEffect(() => {
    if (tier !== "lg") setFocusedSlug(null);
    else if (focusedSlug !== null && !config.locations.some((loc) => loc.slug === focusedSlug)) {
      setFocusedSlug(null);
    }
  }, [config.locations, focusedSlug, tier]);

  useEffect(() => {
    if (dayCursorDate !== null && !forecast?.daily.some((day) => day.dateLocal === dayCursorDate)) {
      store.getState().setDayCursorDate(null);
    }
  }, [dayCursorDate, forecast, store]);

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
        const onboardingActive =
          state.initStatus === "ready" &&
          ((state.config.locations.length === 0 && !state.onboardingSkipped) ||
            state.onboardingForced);
        return state.overlayOpen || onboardingActive;
      },
      openSearch: () => store.getState().setOverlayOpen(true),
      locationsOpen: () => store.getState().locationsOpen,
      openLocations: () => {
        const state = store.getState();
        if (state.initStatus !== "ready" || state.config.locations.length === 0) return;
        state.setLocationsOpen(true);
      },
      dayDetailOpen: () => store.getState().dayDetailDate !== null,
      closeDayDetail: () => store.getState().setDayDetailDate(null),
      moveDayCursor: (delta) => {
        if (!forecast || forecast.daily.length === 0) return;
        const dates = forecast.daily.map((day) => day.dateLocal);
        const todayDate = localDateAtOffset(nowUtc, forecast.utcOffsetSeconds);
        const current = store.getState().dayCursorDate;
        const currentIndex = current === null ? -1 : dates.indexOf(current);
        const todayIndex = todayDate === null ? -1 : dates.indexOf(todayDate);
        const anchorIndex = currentIndex >= 0 ? currentIndex : Math.max(0, todayIndex);
        const nextIndex = Math.max(0, Math.min(dates.length - 1, anchorIndex + delta));
        store.getState().setDayCursorDate(dates[nextIndex] ?? null);
        const targetPage = Math.floor(nextIndex / DAILY_PAGE_SIZE);
        if (store.getState().dailyPageIndex !== targetPage) {
          store.getState().setDailyPageIndex(targetPage);
        }
      },
      moveDailyPage: (delta) => {
        if (!forecast || forecast.daily.length === 0) return;
        const current = store.getState().dailyPageIndex;
        const next = clampDailyPageIndex(current + delta, forecast.daily.length);
        if (next === current) return;
        store.getState().setDailyPageIndex(next);
        // Why: keep an existing cursor visible on the page it now points at — otherwise the
        // next arrow-key press re-derives its target page from the (now off-screen) cursor and
        // silently snaps the view back to the old page.
        const cursorDate = store.getState().dayCursorDate;
        if (cursorDate === null) return;
        const dates = forecast.daily.map((day) => day.dateLocal);
        const cursorIndex = dates.indexOf(cursorDate);
        const cursorPage = cursorIndex < 0 ? -1 : Math.floor(cursorIndex / DAILY_PAGE_SIZE);
        if (cursorPage !== next) {
          store.getState().setDayCursorDate(dates[next * DAILY_PAGE_SIZE] ?? null);
        }
      },
      openDayDetail: () => {
        if (!forecast || forecast.daily.length === 0) return;
        const dates = forecast.daily.map((day) => day.dateLocal);
        const todayDate = localDateAtOffset(nowUtc, forecast.utcOffsetSeconds);
        const cursorDate = store.getState().dayCursorDate;
        const selected =
          (cursorDate !== null && dates.includes(cursorDate) ? cursorDate : null) ??
          (todayDate !== null && dates.includes(todayDate) ? todayDate : null) ??
          dates[0] ??
          null;
        if (selected !== null) store.getState().setDayDetailDate(selected);
      },
      hourlyInspectOpen: () => store.getState().hourlyInspectTimeUtc !== null,
      toggleHourlyInspect: () => {
        const current = store.getState().hourlyInspectTimeUtc;
        if (current !== null) {
          store.getState().setHourlyInspectTimeUtc(null);
          return;
        }
        if (tier === "xs" || !forecast || !store.getState().config.panels.hourly) return;
        const maxPoints = hourlyWindowMaxPoints(tier);
        const window = sliceUpcoming(forecast.hourly, nowUtc, maxPoints);
        const first = window[0];
        if (!first) return;
        store.getState().setHourlyInspectTimeUtc(first.timeUtc);
      },
      exitHourlyInspect: () => store.getState().setHourlyInspectTimeUtc(null),
      toggleNowcastExpanded: () => {
        if (tier === "xs" || !forecast || !store.getState().config.panels.nowcast) return;
        store.getState().toggleNowcastExpanded();
      },
      moveHourlyInspect: (delta) => {
        if (!forecast) return;
        const maxPoints = hourlyWindowMaxPoints(tier);
        const window = sliceUpcoming(forecast.hourly, nowUtc, maxPoints);
        const next = nextInspectTimeUtc(window, store.getState().hourlyInspectTimeUtc, delta);
        if (next !== null) store.getState().setHourlyInspectTimeUtc(next);
      },
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
    [store, quit, focusedSlug, tier, forecast, nowUtc],
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
      width={viewport.width}
    />
  );

  const staleBadge = stale && !loading && error === undefined;

  const status = (
    <StatusArea
      loading={loading}
      error={error}
      stale={staleBadge}
      deleteArm={deleteArmed ? { label } : undefined}
      actionError={actionError}
      width={tier === "lg" ? viewport.width - SIDEBAR_WIDTH : viewport.width}
      reducedMotion={config.reduced_motion}
    />
  );

  const footerColumnWidth = tier === "lg" ? viewport.width - SIDEBAR_WIDTH : viewport.width;
  const footer = <Footer tier={tier} width={footerColumnWidth} />;

  const mainWidth = tier === "lg" ? viewport.width - SIDEBAR_WIDTH - 4 : viewport.width - 4;

  const forecastVisible =
    forecast !== undefined && !helpOpen && !overlayOpen && !locationsOpen && dayDetailDate === null;
  const overflowEstimate =
    forecastVisible && forecast
      ? estimateMainContentRows({
          tier,
          width: mainWidth,
          forecast,
          panels: config.panels,
          nowUtc,
          hourlyInspectTimeUtc,
          nowcastExpanded,
        })
      : null;
  const statusRows = deleteArmed
    ? 1
    : actionError !== undefined
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
    forecast !== undefined &&
    !helpOpen &&
    !overlayOpen &&
    !locationsOpen &&
    dayDetailDate === null ? (
      <MainContent
        tier={tier}
        width={mainWidth}
        forecast={forecast}
        nowUtc={nowUtc}
        prefs={prefs}
        panels={config.panels}
        scrollHeight={mainScrollHeight}
        airQuality={airQuality}
        selectedDayDateLocal={dayCursorDate}
        dailyPageIndex={dailyPageIndex}
        hourlyInspectTimeUtc={hourlyInspectTimeUtc}
        nowcastExpanded={nowcastExpanded}
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
        <Sidebar store={store} focusedSlug={focusedSlug} prefs={prefs} />
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
                store={store}
                width={viewport.width}
                height={viewport.height}
                providerLabel={config.provider === "nws" ? "api.weather.gov" : "open-meteo.com"}
              />
            ) : null}
            {overlayOpen ? (
              <SearchOverlay store={store} width={viewport.width} height={viewport.height} />
            ) : null}
            {locationsOpen ? (
              <LocationsOverlay store={store} width={viewport.width} height={viewport.height} />
            ) : null}
            {dayDetailDate !== null && forecast ? (
              <DayDetailOverlay
                forecast={forecast}
                dateLocal={dayDetailDate}
                nowUtc={nowUtc}
                prefs={prefs}
                width={viewport.width}
                height={viewport.height}
              />
            ) : null}
          </>
        )}
      </box>
    </ThemeContext>
  );
}
