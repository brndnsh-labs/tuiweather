import { lerpHex } from "../../components/RangeBar";
import { conditionGlyph, conditionLabel } from "../../lib/providers/openmeteo/wmo";
import {
  convertTempC,
  formatTemp,
  formatWind,
  tempWarmthT,
  type Units,
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

  const tempFg = lerpHex(palette.tempCold, palette.tempWarm, tempWarmthT(obs.temperatureC));

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" alignItems="flex-start">
        <ascii-font text={bigTempDigits(obs, units)} font="slick" color={[tempFg, palette.fgDim]} />
        <text fg={tempFg}>°</text>
      </box>
      <text fg={palette.fg}>
        {`${conditionGlyph(obs.condition)} ${conditionLabel(obs.condition)} · feels like ${formatTemp(
          obs.apparentC,
          units,
        )}`}
      </text>
    </box>
  );
}
