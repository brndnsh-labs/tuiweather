import { memo } from "react";
import { RangeBar } from "../../components/RangeBar";
import { localDateAtOffset } from "../../features/daydetail/DayDetailOverlay";
import { sectionRule } from "../../features/hourly/HourlyStrip";
import type { DisplayPrefs, TuiConfig } from "../../lib/config/schema";
import { conditionIcon } from "../../lib/weather/condition-display";
import {
  deriveNowcast,
  describeNowcast,
  precipGlyph,
  upcomingPrecipSeries,
  WET_MM,
} from "../../lib/weather/derive";
import {
  aqiCategory,
  displayWidth,
  formatClock,
  formatPct,
  formatPrecip,
  formatTemp,
  truncateCells,
} from "../../lib/weather/format";
import type { AirQuality, NormalizedForecast } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";
import type { WeatherStore } from "../store";

export const SIDEBAR_WIDTH = 26;
/**
 * One column narrower than the bordered box's interior: text at exactly the
 * container width can wrap its last glyph onto an extra row (AGENTS.md).
 */
export const SIDEBAR_CONTENT_WIDTH = SIDEBAR_WIDTH - 3;
/** Border pair — the rail's fixed row overhead. */
export const RAIL_BORDER_ROWS = 2;
/** Each rail section opens with a `── title ──` rule row. */
const SECTION_RULE_ROWS = 1;
/** minutely_15 buckets, so one tick label per four columns. */
const BUCKETS_PER_HOUR = 4;

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
      {truncateTo(`${bullet} ${truncateTo(label, labelBudget)}${tail}`, SIDEBAR_CONTENT_WIDTH)}
    </text>
  );
});

export type NowTone = "accent" | "warn" | "dim";

export interface NowSection {
  line: string;
  strip: string | null;
  ticks: string | null;
  tone: NowTone;
}

/**
 * Relative hour ticks under the precip strip. Clock labels collide in a
 * 23-column rail; "now / +1h / +2h" reads at a glance and always fits.
 * Written per character, never per slot (AGENTS.md) — a multi-char label
 * assigned to one array entry shifts every column after it.
 */
export function relativeTicks(length: number): string | null {
  if (length <= 0) return null;
  const chars = new Array<string>(length).fill(" ");
  let wrote = false;
  for (let i = 0; i < length; i += BUCKETS_PER_HOUR) {
    const hours = i / BUCKETS_PER_HOUR;
    const label = hours === 0 ? "now" : `+${hours}h`;
    if (i + label.length > length) break;
    for (let k = 0; k < label.length; k++) chars[i + k] = label[k] ?? " ";
    wrote = true;
  }
  return wrote ? chars.join("") : null;
}

/**
 * The rail's nowcast card. Null when the provider has no minute-level feed
 * (NWS): the section disappears rather than rendering a false "Dry" (#102).
 * A genuine dry reading keeps the line but drops the flat all-`▁` strip.
 */
export function buildNowSection(
  forecast: NormalizedForecast,
  nowUtc: string,
  width: number,
): NowSection | null {
  const nowcast = deriveNowcast(forecast, nowUtc);
  if (nowcast.kind === "unavailable") return null;
  const line = truncateTo(describeNowcast(nowcast), width);
  if (nowcast.kind === "dry") return { line, strip: null, ticks: null, tone: "dim" };
  const series = upcomingPrecipSeries(forecast, nowUtc).slice(0, Math.max(0, width));
  const strip = series.some((mm) => mm >= WET_MM) ? series.map(precipGlyph).join("") : null;
  return {
    line,
    strip,
    ticks: strip === null ? null : relativeTicks(strip.length),
    tone: nowcast.kind === "ongoing" ? "accent" : "warn",
  };
}

export interface TodayBlock {
  lo: number;
  hi: number;
  weekMin: number;
  weekMax: number;
  loLabel: string;
  hiLabel: string;
  barWidth: number;
  precip: string | null;
  sun: string | null;
  air: string | null;
}

export function buildTodayBlock(
  forecast: NormalizedForecast,
  prefs: DisplayPrefs,
  airQuality: AirQuality | null | undefined,
  width: number,
  nowUtc: string,
): TodayBlock | null {
  const todayDate = localDateAtOffset(nowUtc, forecast.utcOffsetSeconds);
  const today =
    (todayDate !== null ? forecast.daily.find((day) => day.dateLocal === todayDate) : undefined) ??
    forecast.daily[0];
  if (!today) return null;
  const loLabel = formatTemp(today.tempMinC, prefs.temp);
  const hiLabel = formatTemp(today.tempMaxC, prefs.temp);
  const barWidth = Math.max(1, width - displayWidth(loLabel) - displayWidth(hiLabel) - 2);

  const precipParts = [
    today.precipProbabilityMaxPct === null ? null : `☂ ${formatPct(today.precipProbabilityMaxPct)}`,
    today.precipSumMm > 0 ? formatPrecip(today.precipSumMm, prefs.precip) : null,
  ].filter((part): part is string => part !== null);

  const sunrise =
    today.sunriseUtc === null
      ? null
      : formatClock(today.sunriseUtc, forecast.utcOffsetSeconds, prefs.timeFormat);
  const sunset =
    today.sunsetUtc === null
      ? null
      : formatClock(today.sunsetUtc, forecast.utcOffsetSeconds, prefs.timeFormat);

  const uv = forecast.current.uvIndex;
  const aqi = airQuality?.usAqi ?? null;
  const airParts = [
    uv === null ? null : `uv ${Math.round(uv)}`,
    aqi === null ? null : `aqi ${Math.round(aqi)} ${aqiCategory(aqi)}`,
  ].filter((part): part is string => part !== null);

  return {
    lo: today.tempMinC,
    hi: today.tempMaxC,
    weekMin: Math.min(...forecast.daily.map((d) => d.tempMinC)),
    weekMax: Math.max(...forecast.daily.map((d) => d.tempMaxC)),
    loLabel,
    hiLabel,
    barWidth,
    precip: precipParts.length > 0 ? truncateTo(precipParts.join(" · "), width) : null,
    sun:
      sunrise !== null && sunset !== null ? truncateTo(`↑ ${sunrise}  ↓ ${sunset}`, width) : null,
    air: airParts.length > 0 ? truncateTo(airParts.join(" · "), width) : null,
  };
}

export function nowSectionRows(section: NowSection | null): number {
  if (section === null) return 0;
  return (
    SECTION_RULE_ROWS + 1 + (section.strip === null ? 0 : 1) + (section.ticks === null ? 0 : 1)
  );
}

export function todayBlockRows(block: TodayBlock | null): number {
  if (block === null) return 0;
  return (
    SECTION_RULE_ROWS +
    1 +
    (block.precip === null ? 0 : 1) +
    (block.sun === null ? 0 : 1) +
    (block.air === null ? 0 : 1)
  );
}

/**
 * Clamps the location list to the rows actually available, keeping the
 * active location in view. Rendering every configured location unconditionally
 * overflows the bordered box on a short rail with a long list, and OpenTUI
 * drops rows non-contiguously rather than clipping cleanly (#195).
 *
 * When the list doesn't fit, one row is reserved for a "+N more" affordance
 * and the window slides so the active slug is never scrolled out.
 */
export function visibleLocationRows(
  slugs: string[],
  activeSlug: string | null,
  availableRows: number,
): { visible: string[]; hiddenCount: number } {
  if (availableRows <= 0) return { visible: [], hiddenCount: slugs.length };
  if (slugs.length <= availableRows) return { visible: slugs, hiddenCount: 0 };
  const displayRows = Math.max(0, availableRows - 1);
  const activeIndex = activeSlug === null ? -1 : slugs.indexOf(activeSlug);
  const start =
    activeIndex >= displayRows
      ? Math.min(activeIndex - displayRows + 1, slugs.length - displayRows)
      : 0;
  const visible = slugs.slice(start, start + displayRows);
  return { visible, hiddenCount: slugs.length - visible.length };
}

/**
 * Sections shed bottom-up when the rail runs out of rows: the location list
 * is the sidebar's reason to exist and always wins, then the nowcast, then
 * today. A section renders whole or not at all — a half-drawn card reads as
 * a rendering bug.
 */
export function railFit(
  availableRows: number,
  locationRows: number,
  nowRows: number,
  todayRows: number,
): { now: boolean; today: boolean } {
  let used = locationRows;
  const now = nowRows > 0 && used + nowRows <= availableRows;
  if (now) used += nowRows;
  return { now, today: todayRows > 0 && used + todayRows <= availableRows };
}

interface SidebarProps {
  store: WeatherStore;
  focusedSlug: string | null;
  prefs: DisplayPrefs;
  forecast?: NormalizedForecast;
  nowUtc: string;
  airQuality?: AirQuality | null;
  panels: TuiConfig["panels"];
  height: number;
}

export const Sidebar = memo(function Sidebar({
  store,
  focusedSlug,
  prefs,
  forecast,
  nowUtc,
  airQuality,
  panels,
  height,
}: SidebarProps) {
  const palette = usePalette();
  const config = store((s) => s.config);
  const activeSlug = store((s) => s.activeSlug);

  const width = SIDEBAR_CONTENT_WIDTH;
  const availableRows = Math.max(0, height - RAIL_BORDER_ROWS);
  const slugs = config.locations.map((loc) => loc.slug);
  const { visible: visibleSlugs, hiddenCount } = visibleLocationRows(
    slugs,
    // Anchor on the keyboard focus when there is one — j/k must be able to scroll
    // the window, or focus can land on a location the clamp has hidden with no
    // indication anything moved (#195 follow-up). Falls back to the active
    // location so the common, no-focus case still keeps it in view.
    focusedSlug ?? activeSlug,
    availableRows,
  );
  const visibleSlugSet = new Set(visibleSlugs);
  const visibleLocations = config.locations.filter((loc) => visibleSlugSet.has(loc.slug));
  const locationRows = visibleSlugs.length + (hiddenCount > 0 ? 1 : 0);

  const now =
    forecast !== undefined && panels.nowcast ? buildNowSection(forecast, nowUtc, width) : null;
  const today =
    forecast !== undefined && panels.details
      ? buildTodayBlock(forecast, prefs, airQuality, width, nowUtc)
      : null;
  const fit = railFit(availableRows, locationRows, nowSectionRows(now), todayBlockRows(today));
  const nowFg =
    now === null
      ? palette.fgDim
      : now.tone === "accent"
        ? palette.accent
        : now.tone === "warn"
          ? palette.warn
          : palette.fgDim;

  return (
    <box
      width={SIDEBAR_WIDTH}
      border
      borderColor={palette.border}
      title="locations · l"
      flexDirection="column"
    >
      {visibleLocations.map((loc) => (
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
      {hiddenCount > 0 ? (
        <text fg={palette.fgDim}>{truncateTo(`… +${hiddenCount} more · l`, width)}</text>
      ) : null}
      {fit.now && now !== null ? (
        <>
          <text fg={palette.fgDim}>{sectionRule("now · m", width)}</text>
          <text fg={nowFg}>{now.line}</text>
          {now.strip !== null ? <text fg={nowFg}>{now.strip}</text> : null}
          {now.ticks !== null ? <text fg={palette.fgDim}>{now.ticks}</text> : null}
        </>
      ) : null}
      {fit.today && today !== null ? (
        <>
          {/* Locations and the nowcast stay top-anchored where they're glanceable; today
              pins to the bottom so a tall rail's leftover space reads as structure
              rather than a trailing hole. Collapses to nothing when rows are tight. */}
          <box flexGrow={1} />
          <text fg={palette.fgDim}>{sectionRule("today", width)}</text>
          <box flexDirection="row">
            <text fg={palette.fgDim}>{`${today.loLabel} `}</text>
            <RangeBar
              lo={today.lo}
              hi={today.hi}
              weekMin={today.weekMin}
              weekMax={today.weekMax}
              width={today.barWidth}
              palette={palette}
            />
            <text fg={palette.fgDim}>{` ${today.hiLabel}`}</text>
          </box>
          {today.precip !== null ? <text fg={palette.rain}>{today.precip}</text> : null}
          {today.sun !== null ? <text fg={palette.fgDim}>{today.sun}</text> : null}
          {today.air !== null ? <text fg={palette.fgDim}>{today.air}</text> : null}
        </>
      ) : null}
    </box>
  );
});
