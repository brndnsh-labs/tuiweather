import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import { isActionErrorActive, isDeleteArmed, type WeatherStore } from "../../app/store";
import { type DisplayPrefs, resolveDisplayPrefs } from "../../lib/config/schema";
import { conditionIcon } from "../../lib/weather/condition-display";
import { displayWidth, formatTemp, truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

export const LOCATIONS_BOX_WIDTH = 54;
const MIN_BOX_HEIGHT = 6;
/** Border pair + footer rule + two footer lines around the location rows. */
const CHROME_ROWS = 5;

interface LocationsOverlayProps {
  store: WeatherStore;
  width: number;
  height: number;
}

function rowLine(
  num: string,
  marker: string,
  isDefault: boolean,
  label: string,
  tail: string,
  width: number,
): string {
  const prefix = `${num}${marker}${isDefault ? "★" : " "} `;
  const budget = Math.max(0, width - displayWidth(prefix) - displayWidth(tail));
  return `${prefix}${truncateCells(label, budget)}${tail}`;
}

export function LocationsOverlay({ store, width, height }: LocationsOverlayProps) {
  const palette = usePalette();
  const config = store((s) => s.config);
  const activeSlug = store((s) => s.activeSlug);
  const forecastBySlug = store((s) => s.forecastBySlug);
  const lastActionError = store((s) => s.lastActionError);
  const lastActionErrorAtMs = store((s) => s.lastActionErrorAtMs);
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);
  const [armedSlug, setArmedSlug] = useState<string | null>(null);
  const [armedAtMs, setArmedAtMs] = useState<number | null>(null);

  const prefs: DisplayPrefs = useMemo(() => resolveDisplayPrefs(config), [config]);
  const locations = config.locations;
  const count = locations.length;

  const boxWidth = Math.max(1, Math.min(LOCATIONS_BOX_WIDTH, width >= 32 ? width - 2 : width));
  const boxHeight = Math.max(
    Math.min(MIN_BOX_HEIGHT, height),
    Math.min(height, count + CHROME_ROWS),
  );
  const innerWidth = Math.max(1, boxWidth - 2);
  const visibleLimit = Math.max(1, boxHeight - CHROME_ROWS);

  const clampedCursor = Math.min(cursor, Math.max(0, count - 1));
  const clampedOffset = Math.min(offset, Math.max(0, count - visibleLimit));
  const visible = locations.slice(clampedOffset, clampedOffset + visibleLimit);
  const cursorLocation = locations[clampedCursor];
  const armed = isDeleteArmed(armedAtMs, Date.now());

  const move = (delta: 1 | -1) => {
    if (count === 0) return;
    const next = (clampedCursor + delta + count) % count;
    setCursor(next);
    setOffset((o) => (next < o ? next : next >= o + visibleLimit ? next - visibleLimit + 1 : o));
  };

  const followSlug = (slug: string) => {
    const idx = store.getState().config.locations.findIndex((loc) => loc.slug === slug);
    if (idx === -1) return;
    setCursor(idx);
    setOffset((o) => (idx < o ? idx : idx >= o + visibleLimit ? idx - visibleLimit + 1 : o));
  };

  const close = () => store.getState().setLocationsOpen(false);

  const switchTo = (slug: string) => {
    store.getState().switchLocation(slug);
    close();
  };

  const openSearch = () => {
    close();
    store.getState().setOverlayOpen(true);
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      close();
      return;
    }
    if (count === 0 || !cursorLocation) return;
    const slug = cursorLocation.slug;
    if (key.name === "up" || (key.name === "k" && !key.shift)) {
      move(-1);
      return;
    }
    if (key.name === "down" || (key.name === "j" && !key.shift)) {
      move(1);
      return;
    }
    if (key.name === "j" && key.shift) {
      void store
        .getState()
        .moveLocation(slug, 1)
        .then(() => followSlug(slug));
      return;
    }
    if (key.name === "k" && key.shift) {
      void store
        .getState()
        .moveLocation(slug, -1)
        .then(() => followSlug(slug));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      switchTo(slug);
      return;
    }
    if (key.name === "s") {
      void store.getState().setDefaultLocation(slug);
      return;
    }
    if (key.name === "d") {
      if (isDeleteArmed(armedAtMs, Date.now()) && armedSlug === slug) {
        setArmedSlug(null);
        setArmedAtMs(null);
        setCursor((c) => Math.max(0, Math.min(c, count - 2)));
        void store.getState().deleteLocation(slug);
      } else {
        store.getState().clearActionError();
        setArmedSlug(slug);
        setArmedAtMs(Date.now());
      }
      return;
    }
    if (key.name === "/") {
      openSearch();
      return;
    }
    if (/^[1-9]$/.test(key.name)) {
      const idx = Number.parseInt(key.name, 10) - 1;
      const target = locations[idx];
      if (target) switchTo(target.slug);
    }
  });

  const rows = visible.map((loc, i) => {
    const idx = clampedOffset + i;
    const isCursor = idx === clampedCursor;
    const isActive = loc.slug === activeSlug;
    const entry = forecastBySlug[loc.slug];
    const tail = entry
      ? ` ${conditionIcon(entry.forecast.current.condition)} ${formatTemp(entry.forecast.current.temperatureC, prefs.temp)}`
      : "";
    return (
      <text
        key={loc.slug}
        fg={isCursor ? palette.accent : isActive ? palette.fg : palette.fgDim}
        bg={palette.surface}
      >
        {rowLine(
          idx < 9 ? `${idx + 1}` : " ",
          isCursor ? "▸" : isActive ? "●" : "○",
          config.default_location === loc.slug,
          loc.label,
          tail,
          innerWidth,
        )}
      </text>
    );
  });

  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = Math.max(0, Math.floor((height - boxHeight) / 2));
  const armedLabel =
    armed && armedSlug !== null
      ? (locations.find((loc) => loc.slug === armedSlug)?.label ?? null)
      : null;
  const overlayActionError = isActionErrorActive(lastActionErrorAtMs, Date.now())
    ? lastActionError
    : undefined;

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={boxWidth}
      height={boxHeight}
      zIndex={10}
      border
      borderColor={palette.accent}
      backgroundColor={palette.surface}
      title={truncateCells("locations", innerWidth)}
      flexDirection="column"
    >
      {rows}
      <box flexGrow={1} backgroundColor={palette.surface} />
      <text fg={palette.border} bg={palette.surface}>
        {"─".repeat(innerWidth)}
      </text>
      {overlayActionError !== undefined ? (
        <text fg={palette.danger} bg={palette.surface}>
          {truncateCells(overlayActionError, Math.max(0, innerWidth - 1))}
        </text>
      ) : armedLabel !== null ? (
        <text fg={palette.danger} bg={palette.surface}>
          {truncateCells(`d again deletes ${armedLabel}`, innerWidth)}
        </text>
      ) : (
        <text fg={palette.fgDim} bg={palette.surface}>
          {truncateCells("↑↓ move · enter switch · 1-9 jump · esc close", innerWidth)}
        </text>
      )}
      <text fg={palette.fgDim} bg={palette.surface}>
        {truncateCells("s default · d del×2 · J/K move · / add", innerWidth)}
      </text>
    </box>
  );
}
