import type { DisplayPrefs } from "../../lib/config/schema";
import {
  aqiCategory,
  formatClock,
  formatPressure,
  formatTemp,
  formatVisibility,
  formatWind,
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

function Cell({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <text fg={palette.fgDim}>
      {`${label.padEnd(LABEL_PAD)}`}
      <span fg={palette.fg}>{value}</span>
    </text>
  );
}

export function DetailsGrid({
  obs,
  today,
  utcOffsetSeconds,
  prefs,
  colWidth,
  airQuality,
}: DetailsGridProps) {
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
  const air =
    airQuality?.usAqi != null
      ? `${Math.round(airQuality.usAqi)} ${aqiCategory(airQuality.usAqi)}`
      : null;

  const halfWidth = colWidth ?? 20;

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
  ];
  if (air !== null) {
    rows.push([["air", air]]);
  }

  return (
    <box flexDirection="column">
      {rows.map((pair) => (
        <box key={pair.map(([label]) => label).join("-")} flexDirection="row">
          {pair.map(([label, value]) => (
            <box key={label} width={halfWidth} flexShrink={0} flexDirection="row">
              <Cell label={label} value={value} />
            </box>
          ))}
        </box>
      ))}
    </box>
  );
}
