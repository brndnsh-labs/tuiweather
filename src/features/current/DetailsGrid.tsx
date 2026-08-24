import {
  formatClock,
  formatTemp,
  formatVisibility,
  formatWind,
  type Units,
  uvLabel,
} from "../../lib/weather/format";
import type { CurrentObs, DailyPoint } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface DetailsGridProps {
  obs: CurrentObs;
  today?: DailyPoint;
  utcOffsetSeconds: number;
  units: Units;
  colWidth?: number;
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

export function DetailsGrid({ obs, today, utcOffsetSeconds, units, colWidth }: DetailsGridProps) {
  const humidity = `${Math.round(obs.humidityPct)}%`;
  const dewPoint = obs.dewPointC === null ? "--" : formatTemp(obs.dewPointC, units);
  const pressure = obs.pressureHpa === null ? "--" : `${Math.round(obs.pressureHpa)} hPa`;
  const gusts = obs.windGustKmh === null ? "--" : formatWind(obs.windGustKmh, null, units);
  const uv = obs.uvIndex === null ? "--" : `${Math.round(obs.uvIndex)} ${uvLabel(obs.uvIndex)}`;
  const visibility = formatVisibility(obs.visibilityM, units);
  const sunrise = today?.sunriseUtc ? formatClock(today.sunriseUtc, utcOffsetSeconds) : "--";
  const sunset = today?.sunsetUtc ? formatClock(today.sunsetUtc, utcOffsetSeconds) : "--";

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
