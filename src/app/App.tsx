import { useKeyboard, useRenderer } from "@opentui/react";
import { type ReactNode, useEffect, useMemo } from "react";
import { conditionGlyph } from "../lib/providers/openmeteo/wmo";
import { formatTemp } from "../lib/weather/format";
import { resolvePalette } from "../theme/palette";
import { ThemeContext } from "../theme/tokens";
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

export function App(props: AppProps = {}) {
  const store = props.store ?? appStore;
  const config = store((s) => s.config);
  const activeSlug = store((s) => s.activeSlug);
  const entry = store((s) => (activeSlug === null ? undefined : s.forecastBySlug[activeSlug]));
  const loading = store((s) =>
    activeSlug === null ? false : (s.loadingSlugs[activeSlug] ?? false),
  );
  const error = store((s) => (activeSlug === null ? undefined : s.errorBySlug[activeSlug]));
  const stale = store((s) => (activeSlug === null ? false : (s.staleBySlug[activeSlug] ?? false)));
  const helpOpen = store((s) => s.helpOpen);
  const forecastBySlug = store((s) => s.forecastBySlug);

  const viewport = useViewport();
  const renderer = useRenderer();

  const isDay = entry?.forecast.current.isDay ?? true;
  const palette = useMemo(() => resolvePalette(config.theme, isDay), [config.theme, isDay]);

  useEffect(() => {
    void store.getState().init(props.initialSlug);
  }, [store, props.initialSlug]);

  const quit = props.quit ?? (() => renderer.destroy());
  const api = useMemo<KeymapApi>(
    () => ({
      quit,
      activeSlug: () => store.getState().activeSlug,
      refresh: (slug) => void store.getState().refresh(slug),
      cycleLocation: (delta) => store.getState().cycleLocation(delta),
      toggleUnits: () => store.getState().toggleUnits(),
      helpOpen: () => store.getState().helpOpen,
      toggleHelp: () => store.getState().toggleHelp(),
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
  const tier = viewport.tier;

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

  const placeholder = (
    <box border borderColor={palette.border} flexGrow={1} title={`main · ${tier}`}>
      <text fg={palette.fgDim}>{tier}</text>
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
          {placeholder}
          {footer}
        </box>
      </box>
    );
  } else {
    body = (
      <box flexDirection="column" flexGrow={1} gap={1}>
        {header}
        {status}
        {placeholder}
        {footer}
      </box>
    );
  }

  return (
    <ThemeContext value={palette}>
      <box flexDirection="column" width="100%" height="100%">
        {body}
        {helpOpen ? <HelpOverlay width={viewport.width} height={viewport.height} /> : null}
      </box>
    </ThemeContext>
  );
}
