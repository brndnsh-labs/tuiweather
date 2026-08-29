import { memo } from "react";
import type { DisplayPrefs } from "../../lib/config/schema";
import { conditionIcon } from "../../lib/weather/condition-display";
import { displayWidth, formatTemp, truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";
import type { WeatherStore } from "../store";

export const SIDEBAR_WIDTH = 26;

function truncateTo(text: string, width: number): string {
  return truncateCells(text, width);
}

interface SidebarRowProps {
  slug: string;
  label: string;
  store: WeatherStore;
  isActive: boolean;
  isFocused: boolean;
  prefs: DisplayPrefs;
}

const SidebarRow = memo(function SidebarRow({
  slug,
  label,
  store,
  isActive,
  isFocused,
  prefs,
}: SidebarRowProps) {
  const locEntry = store((s) => s.forecastBySlug[slug]);
  const palette = usePalette();
  const bullet = isFocused ? "▸" : isActive ? "●" : "○";
  const fg = isFocused
    ? isActive
      ? palette.accent
      : palette.fg
    : isActive
      ? palette.accent
      : palette.fgDim;
  const tail = locEntry
    ? ` ${conditionIcon(locEntry.forecast.current.condition)} ${formatTemp(locEntry.forecast.current.temperatureC, prefs.temp)}`
    : "";
  const labelBudget = Math.max(0, SIDEBAR_WIDTH - 2 - displayWidth(tail) - 2 - 1);
  return (
    <text fg={fg}>
      {truncateTo(`${bullet} ${truncateTo(label, labelBudget)}${tail}`, SIDEBAR_WIDTH - 3)}
    </text>
  );
});

interface SidebarProps {
  store: WeatherStore;
  focusedSlug: string | null;
  prefs: DisplayPrefs;
}

export const Sidebar = memo(function Sidebar({ store, focusedSlug, prefs }: SidebarProps) {
  const palette = usePalette();
  const config = store((s) => s.config);
  const activeSlug = store((s) => s.activeSlug);
  return (
    <box
      width={SIDEBAR_WIDTH}
      border
      borderColor={palette.border}
      title="locations · l"
      flexDirection="column"
    >
      {config.locations.map((loc) => (
        <SidebarRow
          key={loc.slug}
          slug={loc.slug}
          label={loc.label}
          store={store}
          isActive={loc.slug === activeSlug}
          isFocused={loc.slug === focusedSlug}
          prefs={prefs}
        />
      ))}
    </box>
  );
});
