import { lerpHex } from "../../components/RangeBar";
import type { DisplayPrefs } from "../../lib/config/schema";
import { conditionIcon, conditionLabel } from "../../lib/providers/openmeteo/wmo";
import { convertTempC, formatTemp, formatWind, tempWarmthT } from "../../lib/weather/format";
import type { CurrentObs } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface HeroProps {
  obs: CurrentObs;
  prefs: DisplayPrefs;
  compact?: boolean;
  mini?: boolean;
}

function bigTempDigits(obs: CurrentObs, units: DisplayPrefs["temp"]): string {
  return String(Math.round(convertTempC(obs.temperatureC, units)));
}

function StatLine({ parts, dim }: { parts: (string | null)[]; dim: string }) {
  const joined = parts.filter((p) => p !== null).join(" · ");
  if (joined.length === 0) return null;
  return <text fg={dim}>{joined}</text>;
}

export function Hero({ obs, prefs, compact = false, mini = false }: HeroProps) {
  const palette = usePalette();

  if (mini) {
    return (
      <box flexDirection="row" gap={1}>
        <text fg={palette.tempWarm}>{formatTemp(obs.temperatureC, prefs.temp)}</text>
        <text fg={palette.fg}>
          {`${conditionLabel(obs.condition)} · fl ${formatTemp(obs.apparentC, prefs.temp)}`}
        </text>
      </box>
    );
  }

  if (compact) {
    return (
      <box flexDirection="column">
        <box flexDirection="row" gap={1}>
          <text fg={palette.tempWarm}>{`${formatTemp(obs.temperatureC, prefs.temp)}`}</text>
          <text fg={palette.fg}>
            {`${conditionLabel(obs.condition)} · feels like ${formatTemp(obs.apparentC, prefs.temp)}`}
          </text>
        </box>
        <StatLine
          dim={palette.fgDim}
          parts={[
            formatWind(obs.windSpeedKmh, obs.windDirectionDeg, prefs.wind),
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
        <ascii-font
          text={bigTempDigits(obs, prefs.temp)}
          font="slick"
          color={[tempFg, palette.fgDim]}
        />
        <text fg={tempFg}>°</text>
      </box>
      <text fg={palette.fg}>
        {`${conditionIcon(obs.condition)} ${conditionLabel(obs.condition)} · feels like ${formatTemp(
          obs.apparentC,
          prefs.temp,
        )}`}
      </text>
    </box>
  );
}
