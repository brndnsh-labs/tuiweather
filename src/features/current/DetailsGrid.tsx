import { memo } from "react";
import type { DisplayPrefs } from "../../lib/config/schema";
import {
  aqiCategory,
  formatClock,
  formatPressure,
  formatTemp,
  formatVisibility,
  formatWind,
  truncateCells,
  uvLabel,
} from "../../lib/weather/format";
import type { AirQuality, CurrentObs, DailyPoint } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface DetailsGridProps {
  obs: CurrentObs;
  today?: DailyPoint;
  utcOffsetSeconds: number;
  prefs: DisplayPrefs;
  colWidth?: number;
  airQuality?: AirQuality | null;
}

const LABEL_PAD = 9;

function Cell({ label, value, width }: { label: string; value: string; width: number }) {
  const palette = usePalette();
  return (
    <text fg={palette.fgDim} height={1}>
      {`${label.padEnd(LABEL_PAD)}`}
      <span fg={palette.fg}>{truncateCells(value, Math.max(0, width - LABEL_PAD - 1))}</span>
    </text>
  );
}

export const DetailsGrid = memo(function DetailsGrid({
  obs,
  today,
  utcOffsetSeconds,
  prefs,
  colWidth,
  airQuality,
}: DetailsGridProps) {
  const palette = usePalette();
  const humidity = `${Math.round(obs.humidityPct)}%`;
  const dewPoint = obs.dewPointC === null ? "--" : formatTemp(obs.dewPointC, prefs.temp);
  const pressure = formatPressure(obs.pressureHpa, prefs.pressure);
  const gusts = obs.windGustKmh === null ? "--" : formatWind(obs.windGustKmh, null, prefs.wind);
  const uv = obs.uvIndex === null ? "--" : `${Math.round(obs.uvIndex)} ${uvLabel(obs.uvIndex)}`;
  const visibility = formatVisibility(obs.visibilityM, prefs.wind);
  const sunrise = today?.sunriseUtc
    ? formatClock(today.sunriseUtc, utcOffsetSeconds, prefs.timeFormat)
    : "--";
  const sunset = today?.sunsetUtc
    ? formatClock(today.sunsetUtc, utcOffsetSeconds, prefs.timeFormat)
    : "--";
  const halfWidth = colWidth ?? 20;

  const air =
    airQuality?.usAqi != null
      ? truncateCells(
          `${Math.round(airQuality.usAqi)} ${aqiCategory(airQuality.usAqi)}`,
          Math.max(1, halfWidth - LABEL_PAD),
        )
      : null;

  const rows: [string, string][][] = [
    [
      ["humidity", humidity],
      ["dew pt", dewPoint],
    ],
    [
      ["pressure", pressure],
      ["gusts", gusts],
    ],
    [
      ["uv", uv],
      ["vis", visibility],
    ],
    [
      ["sunrise", sunrise],
      ["sunset", sunset],
    ],
    [["wind", formatWind(obs.windSpeedKmh, obs.windDirectionDeg, prefs.wind)]],
  ];
  if (air !== null) {
    rows[4]?.push(["air", air]);
  }

  return (
    <box flexDirection="column">
      <text fg={palette.accent} height={1}>
        <b>ATMOSPHERE</b>
      </text>
      {rows.map((pair) => (
        <box key={pair.map(([label]) => label).join("-")} flexDirection="row">
          {pair.map(([label, value]) => (
            <box key={label} width={halfWidth} flexShrink={0} flexDirection="row">
              <Cell label={label} value={value} width={halfWidth} />
            </box>
          ))}
        </box>
      ))}
    </box>
  );
});
