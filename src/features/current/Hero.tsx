import { memo } from "react";
import { lerpHex } from "../../components/RangeBar";
import { WeatherArt } from "../../components/WeatherArt";
import type { DisplayPrefs } from "../../lib/config/schema";
import { conditionIcon, conditionLabel } from "../../lib/weather/condition-display";
import {
  convertTempC,
  formatTemp,
  formatWind,
  tempWarmthT,
  truncateCells,
} from "../../lib/weather/format";
import type { CurrentObs } from "../../lib/weather/types";
import { ensureContrast, FOREGROUND_CONTRAST_FLOOR } from "../../theme/palette";
import { usePalette } from "../../theme/tokens";

interface HeroProps {
  obs: CurrentObs;
  prefs: DisplayPrefs;
  compact?: boolean;
  mini?: boolean;
  width?: number;
}

function bigTempDigits(obs: CurrentObs, units: DisplayPrefs["temp"]): string {
  return String(Math.round(convertTempC(obs.temperatureC, units)));
}

const DIGITS: Record<string, readonly [string, string, string]> = {
  "0": ["█▀▀█", "█  █", "█▄▄█"],
  "1": [" ▄█ ", "  █ ", " ▄█▄"],
  "2": ["▀▀▀█", " ▄▄▀", "█▄▄▄"],
  "3": ["▀▀▀█", " ▀▀█", "▄▄▄█"],
  "4": ["█  █", "█▄▄█", "   █"],
  "5": ["█▀▀▀", "▀▀▀█", "▄▄▄█"],
  "6": ["█▀▀▀", "█▀▀█", "█▄▄█"],
  "7": ["▀▀▀█", "  █ ", " █  "],
  "8": ["█▀▀█", "█▀▀█", "█▄▄█"],
  "9": ["█▀▀█", "▀▄▄█", "▄▄▄█"],
  "-": ["    ", " ▀▀ ", "    "],
};

function temperatureArt(value: string, width: number): string {
  const scale = value.length * 10 - 2 <= width ? 2 : 1;
  return [0, 1, 2]
    .map((row) =>
      [...value]
        .map((digit) =>
          [...(DIGITS[digit]?.[row] ?? "    ")].map((cell) => cell.repeat(scale)).join(""),
        )
        .join(" ".repeat(scale)),
    )
    .join("\n");
}

function StatLine({ parts, dim }: { parts: (string | null)[]; dim: string }) {
  const joined = parts.filter((p) => p !== null).join(" · ");
  if (joined.length === 0) return null;
  return <text fg={dim}>{joined}</text>;
}

export const Hero = memo(function Hero({
  obs,
  prefs,
  compact = false,
  mini = false,
  width = 38,
}: HeroProps) {
  const palette = usePalette();
  const tempFg = ensureContrast(
    lerpHex(palette.tempCold, palette.tempWarm, tempWarmthT(obs.temperatureC)),
    palette.surface,
    FOREGROUND_CONTRAST_FLOOR,
  );

  if (mini) {
    return (
      <text fg={palette.fg} height={1}>
        <span fg={tempFg}>
          <b>{formatTemp(obs.temperatureC, prefs.temp)}</b>
        </span>
        {truncateCells(
          ` ${conditionLabel(obs.condition)} · fl ${formatTemp(obs.apparentC, prefs.temp)}`,
          Math.max(0, width - formatTemp(obs.temperatureC, prefs.temp).length - 1),
        )}
      </text>
    );
  }

  if (compact) {
    return (
      <box flexDirection="column">
        <text fg={palette.fg} height={1}>
          <span fg={tempFg}>
            <b>{formatTemp(obs.temperatureC, prefs.temp)}</b>
          </span>
          {truncateCells(
            ` ${conditionLabel(obs.condition)} · feels like ${formatTemp(obs.apparentC, prefs.temp)}`,
            Math.max(0, width - formatTemp(obs.temperatureC, prefs.temp).length - 1),
          )}
        </text>
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

  return (
    <box flexDirection="column" flexShrink={0} width={width} height={6}>
      <text fg={palette.accent} height={1}>
        <b>CURRENT CONDITIONS</b>
      </text>
      <box flexDirection="row" gap={1} height={5}>
        <box flexDirection="column" width={width >= 43 ? width - 15 : width}>
          <box flexDirection="row" alignItems="flex-start" height={3}>
            <text fg={tempFg} height={3}>
              {temperatureArt(
                bigTempDigits(obs, prefs.temp),
                (width >= 43 ? width - 15 : width) - 3,
              )}
            </text>
            <text fg={tempFg}>°{prefs.temp === "metric" ? "C" : "F"}</text>
          </box>
          <text fg={palette.fg} height={1}>
            {truncateCells(
              `${conditionIcon(obs.condition)} ${conditionLabel(obs.condition)}`,
              (width >= 43 ? width - 15 : width) - 1,
            )}
          </text>
          <text fg={palette.fgDim} height={1}>
            {truncateCells(
              `feels like ${formatTemp(obs.apparentC, prefs.temp)}`,
              (width >= 43 ? width - 15 : width) - 1,
            )}
          </text>
        </box>
        {width >= 43 ? <WeatherArt condition={obs.condition} isDay={obs.isDay} /> : null}
      </box>
    </box>
  );
});
