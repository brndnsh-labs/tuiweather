import { DaylightBar } from "../../components/DaylightBar";
import type { DisplayPrefs } from "../../lib/config/schema";
import {
  formatDayLabel,
  formatPrecip,
  formatTemp,
  formatWind,
  truncateCells,
} from "../../lib/weather/format";
import type { HourlyPoint, NormalizedForecast } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";
import { tierFor } from "../../viewport/breakpoints";
import { HourlyStrip } from "../hourly/HourlyStrip";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LocalDayBounds {
  startMs: number;
  endMs: number;
}

export function localDayBounds(dateLocal: string, utcOffsetSeconds: number): LocalDayBounds | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLocal);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localMidnightMs = Date.UTC(year, month - 1, day);
  const check = new Date(localMidnightMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    !Number.isFinite(utcOffsetSeconds)
  ) {
    return null;
  }
  const startMs = localMidnightMs - utcOffsetSeconds * 1000;
  return { startMs, endMs: startMs + DAY_MS };
}

export function localDateAtOffset(isoUtc: string, utcOffsetSeconds: number): string | null {
  const shiftedMs = Date.parse(isoUtc) + utcOffsetSeconds * 1000;
  if (!Number.isFinite(shiftedMs)) return null;
  return new Date(shiftedMs).toISOString().slice(0, 10);
}

export function sliceHourlyForLocalDay(
  points: HourlyPoint[],
  dateLocal: string,
  utcOffsetSeconds: number,
): HourlyPoint[] {
  const bounds = localDayBounds(dateLocal, utcOffsetSeconds);
  if (!bounds) return [];
  return points.filter((point) => {
    const timeMs = Date.parse(point.timeUtc);
    return timeMs >= bounds.startMs && timeMs < bounds.endMs;
  });
}

interface DayDetailOverlayProps {
  forecast: NormalizedForecast;
  dateLocal: string;
  nowUtc: string;
  prefs: DisplayPrefs;
  width: number;
  height: number;
}

function maxOrNull(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

export interface NightSummary {
  minTempC: number | null;
  precipMm: number;
  firstMorningTempC: number | null;
}

/**
 * Night = this local day's !isDay hours: the pre-sunrise tail and the
 * post-sunset start, both already inside `points` (issue #177, option A —
 * no cross-midnight fetch). "First morning hour" is the day's first point
 * (local midnight), not the sunrise hour — it's the earliest reading a
 * "what does the morning feel like" question could mean without guessing
 * a wake time.
 */
export function deriveNightSummary(points: readonly HourlyPoint[]): NightSummary {
  const night = points.filter((point) => !point.isDay);
  const minTempC = night.length > 0 ? Math.min(...night.map((point) => point.temperatureC)) : null;
  const precipMm = night.reduce((sum, point) => sum + point.precipMm, 0);
  const firstMorningTempC = points[0]?.temperatureC ?? null;
  return { minTempC, precipMm, firstMorningTempC };
}

export function DayDetailOverlay({
  forecast,
  dateLocal,
  nowUtc,
  prefs,
  width,
  height,
}: DayDetailOverlayProps) {
  const palette = usePalette();
  const tier = tierFor(width);
  const compact = tier === "xs" || tier === "sm";
  const fullScreen = tier === "md" || tier === "lg" || width < 32;
  const boxWidth = fullScreen ? Math.max(1, width) : Math.max(1, Math.min(64, width - 2));
  const boxHeight = fullScreen ? Math.max(1, height) : Math.max(1, Math.min(18, height - 2));
  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = Math.max(0, Math.floor((height - boxHeight) / 2));
  const innerWidth = Math.max(1, boxWidth - 2);
  const lineWidth = Math.max(1, innerWidth - 1);

  const day = forecast.daily.find((point) => point.dateLocal === dateLocal);
  const points = sliceHourlyForLocalDay(forecast.hourly, dateLocal, forecast.utcOffsetSeconds);
  const bounds = localDayBounds(dateLocal, forecast.utcOffsetSeconds);
  const chartNowUtc = bounds
    ? new Date(bounds.startMs - 1).toISOString()
    : new Date(0).toISOString();
  const summaryWidth = compact ? lineWidth : Math.min(34, Math.max(22, Math.floor(lineWidth / 3)));
  const chartWidth = compact ? lineWidth : Math.max(6, lineWidth - summaryWidth - 2);
  const windMax = maxOrNull(points.map((point) => point.windSpeedKmh));
  const gustMax = maxOrNull(points.map((point) => point.windGustKmh));
  const uvMax = maxOrNull(points.map((point) => point.uvIndex));
  const precipTotal = points.reduce((sum, point) => sum + point.precipMm, 0);
  const night = deriveNightSummary(points);
  const clip = (value: string, budget = summaryWidth) =>
    truncateCells(value, Math.max(1, budget - 1));

  const summary = (
    <box flexDirection="column" width={summaryWidth} flexShrink={0} gap={1}>
      <box flexDirection="column">
        <text fg={palette.fg}>{clip(`wind max  ${formatWind(windMax, null, prefs.wind)}`)}</text>
        <text fg={palette.fg}>{clip(`gust max  ${formatWind(gustMax, null, prefs.wind)}`)}</text>
        <text fg={palette.fg}>{clip(`UV max    ${uvMax === null ? "--" : uvMax.toFixed(1)}`)}</text>
        <text fg={palette.rain}>
          {clip(`precip    ${formatPrecip(precipTotal, prefs.precip)}`)}
        </text>
      </box>
      <box flexDirection="column">
        <text fg={palette.fgDim}>
          {clip(`night low ${formatTemp(night.minTempC, prefs.temp)}`)}
        </text>
        <text fg={palette.rain}>
          {clip(`night rain ${formatPrecip(night.precipMm, prefs.precip)}`)}
        </text>
        <text fg={palette.fgDim}>
          {clip(`morning   ${formatTemp(night.firstMorningTempC, prefs.temp)}`)}
        </text>
      </box>
      {day ? (
        <DaylightBar
          sunriseUtc={day.sunriseUtc}
          sunsetUtc={day.sunsetUtc}
          nowUtc={nowUtc}
          utcOffsetSeconds={forecast.utcOffsetSeconds}
          width={summaryWidth}
          timeFormat={prefs.timeFormat}
        />
      ) : null}
    </box>
  );

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
      title={truncateCells(`day detail · ${formatDayLabel(dateLocal)} ${dateLocal}`, lineWidth)}
      flexDirection="column"
    >
      <scrollbox
        height={Math.max(1, boxHeight - 3)}
        focused
        viewportCulling={false}
        scrollbarOptions={{ visible: false }}
      >
        {points.length === 0 ? (
          <text fg={palette.fgDim}>{clip("no hourly data for this day", lineWidth)}</text>
        ) : compact ? (
          <box flexDirection="column" gap={1}>
            <HourlyStrip
              points={points}
              nowUtc={chartNowUtc}
              utcOffsetSeconds={forecast.utcOffsetSeconds}
              prefs={prefs}
              maxPoints={points.length}
              width={chartWidth}
              heading={`${points.length} hourly points`}
            />
            {summary}
          </box>
        ) : (
          <box flexDirection="row" gap={2}>
            <box width={chartWidth} flexShrink={0}>
              <HourlyStrip
                points={points}
                nowUtc={chartNowUtc}
                utcOffsetSeconds={forecast.utcOffsetSeconds}
                prefs={prefs}
                maxPoints={points.length}
                width={chartWidth}
                heading={`${points.length} hourly points`}
              />
            </box>
            {summary}
          </box>
        )}
      </scrollbox>
      <text fg={palette.fgDim} bg={palette.surface}>
        {truncateCells("esc close · ↑↓ scroll", lineWidth)}
      </text>
    </box>
  );
}
