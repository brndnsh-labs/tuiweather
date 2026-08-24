import { useKeyboard, useRenderer } from "@opentui/react";
import { type ReactNode, useEffect, useMemo } from "react";
import { Sparkline } from "../components/Sparkline";
import { DetailsGrid } from "../features/current/DetailsGrid";
import { Hero } from "../features/current/Hero";
import { DailyList, dailyChips } from "../features/daily/DailyList";
import { HourlyStrip, sectionRule, sliceUpcoming } from "../features/hourly/HourlyStrip";
import { NowcastBanner } from "../features/nowcast/NowcastBanner";
import { FirstRun } from "../features/onboarding/FirstRun";
import { SearchOverlay } from "../features/search/SearchOverlay";
import { conditionGlyph } from "../lib/providers/openmeteo/wmo";
import { deriveNowcast } from "../lib/weather/derive";
import { formatTemp } from "../lib/weather/format";
import type { NormalizedForecast } from "../lib/weather/types";
import { resolvePalette } from "../theme/palette";
import { ThemeContext, usePalette } from "../theme/tokens";
import type { Tier } from "../viewport/breakpoints";
import { useViewport } from "../viewport/useViewport";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { HelpOverlay } from "./components/HelpOverlay";
import { StatusArea } from "./components/StatusArea";
import { handleKey, type KeymapApi } from "./keymap";
import { appStore, type WeatherStore } from "./store";

const SIDEBAR_WIDTH = 26;

interface AppProps {
  store?: WeatherStore;
  initialSlug?: string;
  quit?: () => void;
  nowMs?: number;
  nowUtc?: string;
}

function truncateTo(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
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
  units: "metric" | "imperial";
}

function XsChips({
  forecast,
  units,
  width,
}: {
  forecast: NormalizedForecast;
  units: "metric" | "imperial";
  width: number;
}) {
  const palette = usePalette();
  return (
    <text fg={palette.fg}>{truncateTo(dailyChips(forecast.daily, units), Math.max(0, width))}</text>
  );
}

function MainContent({ tier, width, forecast, nowUtc, units }: MainContentProps) {
  const palette = usePalette();
  const nowcast = deriveNowcast(forecast, nowUtc);

  if (tier === "xs") {
    const tempValues = sliceUpcoming(forecast.hourly, nowUtc, 12).map((p) => p.temperatureC);
    return (
      <box flexDirection="column" gap={1}>
        <Hero obs={forecast.current} units={units} mini />
        <NowcastBanner nowcast={nowcast} hideWhenDry width={width} />
        {tempValues.length > 0 ? (
          <Sparkline
            values={tempValues}
            width={Math.min(tempValues.length, width)}
            palette={palette}
          />
        ) : null}
        <XsChips forecast={forecast} units={units} width={width} />
      </box>
    );
  }

  if (tier === "sm") {
    return (
      <scrollbox flexGrow={1} focused viewportCulling={false}>
        <box flexDirection="column" gap={1}>
          <Hero obs={forecast.current} units={units} compact />
          <NowcastBanner nowcast={nowcast} hideWhenDry width={width} />
          <HourlyStrip
            points={forecast.hourly}
            nowUtc={nowUtc}
            utcOffsetSeconds={forecast.utcOffsetSeconds}
            units={units}
            maxPoints={12}
            width={width}
          />
          <text fg={palette.fgDim}>{sectionRule(`${forecast.daily.length} day`, width)}</text>
          <DailyList
            days={forecast.daily}
            units={units}
            columns={2}
            width={width}
            showPrecip={false}
          />
        </box>
      </scrollbox>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Hero obs={forecast.current} units={units} />
      {tier === "lg" ? (
        <DetailsGrid
          obs={forecast.current}
          today={forecast.daily[0]}
          utcOffsetSeconds={forecast.utcOffsetSeconds}
          units={units}
          colWidth={Math.max(10, Math.floor(width / 2))}
        />
      ) : null}
      <HourlyStrip
        points={forecast.hourly}
        nowUtc={nowUtc}
        utcOffsetSeconds={forecast.utcOffsetSeconds}
        units={units}
        maxPoints={24}
        width={width}
      />
      <text fg={palette.fgDim}>{sectionRule(`${forecast.daily.length} day`, width)}</text>
      <DailyList days={forecast.daily} units={units} columns={1} width={width} />
    </box>
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
  const lastActionError = store((s) => s.lastActionError);

  const viewport = useViewport();
  const renderer = useRenderer();

  const isDay = entry?.forecast.current.isDay ?? true;
  const palette = useMemo(() => resolvePalette(config.theme, isDay), [config.theme, isDay]);

  useEffect(() => {
    void store.getState().init(props.initialSlug);
  }, [store, props.initialSlug]);

  useEffect(() => {
    return () => {
      store.getState().dispose();
    };
  }, [store]);

  const quit = props.quit ?? (() => renderer.destroy());
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
      deleteActive: () => void store.getState().deleteActiveLocation(),
    }),
    [store, quit],
  );

  useKeyboard((key) => {
    handleKey(key.name, api);
  });

  const activeLocation =
    activeSlug === null ? undefined : config.locations.find((loc) => loc.slug === activeSlug);
  const label = activeLocation?.label ?? "tuiweather";
  const nowMs = props.nowMs ?? Date.now();
  const nowUtc = props.nowUtc ?? new Date(nowMs).toISOString();
  const tier = viewport.tier;
  const forecast = entry?.forecast;
  const onboardingOpen = initStatus === "ready" && config.locations.length === 0;

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
      tier={tier === "lg" || tier === "md" ? undefined : tier}
      fetchedAtMs={entry?.fetchedAtMs}
      stale={stale}
      nowMs={nowMs}
    />
  );

  const status = (
    <StatusArea loading={loading} error={error} stale={stale && !loading && error === undefined} />
  );

  const footer = <Footer tier={tier} />;

  const mainWidth = tier === "lg" ? viewport.width - SIDEBAR_WIDTH - 4 : viewport.width - 4;

  const mainView =
    forecast && !helpOpen && !overlayOpen ? (
      <MainContent
        tier={tier}
        width={mainWidth}
        forecast={forecast}
        nowUtc={nowUtc}
        units={config.units}
      />
    ) : (
      <text fg={palette.fgDim}>{tier}</text>
    );

  const mainPanel = (
    <box
      border
      borderColor={palette.border}
      flexGrow={1}
      title={`main · ${tier}`}
      flexDirection="column"
      paddingX={1}
    >
      {mainView}
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
            const bullet = loc.slug === activeSlug ? "●" : "○";
            const tail = locEntry
              ? ` ${conditionGlyph(locEntry.forecast.current.condition)} ${formatTemp(
                  locEntry.forecast.current.temperatureC,
                  config.units,
                )}`
              : "";
            return (
              <text key={loc.slug} fg={loc.slug === activeSlug ? palette.accent : palette.fgDim}>
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
            {helpOpen ? <HelpOverlay width={viewport.width} height={viewport.height} /> : null}
            {overlayOpen ? (
              <SearchOverlay store={store} width={viewport.width} height={viewport.height} />
            ) : null}
          </>
        )}
      </box>
    </ThemeContext>
  );
}
