import { conditionGlyph, conditionLabel } from "../../lib/providers/openmeteo/wmo";
import {
  convertTempC,
  formatTemp,
  formatWind,
  type Units,
  uvLabel,
} from "../../lib/weather/format";
import type { CurrentObs } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface HeroProps {
  obs: CurrentObs;
  units: Units;
  compact?: boolean;
  mini?: boolean;
}

function bigTempDigits(obs: CurrentObs, units: Units): string {
  return String(Math.round(convertTempC(obs.temperatureC, units)));
}

function StatLine({ parts, dim }: { parts: (string | null)[]; dim: string }) {
  const joined = parts.filter((p) => p !== null).join(" · ");
  if (joined.length === 0) return null;
  return <text fg={dim}>{joined}</text>;
}

export function Hero({ obs, units, compact = false, mini = false }: HeroProps) {
  const palette = usePalette();

  if (mini) {
    return (
      <box flexDirection="row" gap={1}>
        <text fg={palette.tempWarm}>{formatTemp(obs.temperatureC, units)}</text>
        <text fg={palette.fg}>
          {`${conditionLabel(obs.condition)} · fl ${formatTemp(obs.apparentC, units)}`}
        </text>
      </box>
    );
  }

  if (compact) {
    return (
      <box flexDirection="column">
        <box flexDirection="row" gap={1}>
          <text fg={palette.tempWarm}>{`${formatTemp(obs.temperatureC, units)}`}</text>
          <text fg={palette.fg}>
            {`${conditionLabel(obs.condition)} · feels like ${formatTemp(obs.apparentC, units)}`}
          </text>
        </box>
        <StatLine
          dim={palette.fgDim}
          parts={[
            formatWind(obs.windSpeedKmh, obs.windDirectionDeg, units),
            `humidity ${Math.round(obs.humidityPct)}%`,
          ]}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row" alignItems="flex-end">
        <ascii-font text={bigTempDigits(obs, units)} font="tiny" color={palette.tempWarm} />
        <text fg={palette.fgDim}>°</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={palette.fg}>
          {`${conditionGlyph(obs.condition)} ${conditionLabel(obs.condition)} · feels like ${formatTemp(
            obs.apparentC,
            units,
          )}`}
        </text>
      </box>
      <StatLine
        dim={palette.fgDim}
        parts={[
          `↑ ${formatWind(obs.windSpeedKmh, obs.windDirectionDeg, units)}`,
          `humidity ${Math.round(obs.humidityPct)}%`,
          obs.dewPointC === null ? null : `dew pt ${formatTemp(obs.dewPointC, units)}`,
        ]}
      />
      <StatLine
        dim={palette.fgDim}
        parts={[
          obs.uvIndex === null ? "uv --" : `uv ${Math.round(obs.uvIndex)} ${uvLabel(obs.uvIndex)}`,
          "vis --",
          obs.pressureHpa === null ? null : `${Math.round(obs.pressureHpa)} hPa`,
        ]}
      />
    </box>
  );
}
