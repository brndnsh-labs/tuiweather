import { memo } from "react";
import {
  describeNowcast,
  type Nowcast,
  precipGlyph,
  upcomingPrecipSeries,
  WET_MM,
} from "../../lib/weather/derive";
import type { NormalizedForecast } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface NowcastBannerProps {
  nowcast: Nowcast;
  hideWhenDry?: boolean;
  width?: number;
  forecast?: NormalizedForecast;
  nowUtc?: string;
}

function middleTruncate(text: string, width: number): string {
  if (text.length <= width) return text;
  const keep = Math.max(1, width - 1);
  const head = Math.floor(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

function stripFor(series: number[], width: number): string | null {
  const shown = series.slice(0, width);
  if (shown.length === 0 || !shown.some((mm) => mm >= WET_MM)) return null;
  return shown.map((mm) => precipGlyph(mm)).join("");
}

export const NowcastBanner = memo(function NowcastBanner({
  nowcast,
  hideWhenDry = false,
  width,
  forecast,
  nowUtc,
}: NowcastBannerProps) {
  const palette = usePalette();

  if (nowcast.kind === "dry") {
    if (hideWhenDry) return null;
    return (
      <text fg={palette.fgDim}>{middleTruncate(`▔ ${describeNowcast(nowcast)}`, width ?? 80)}</text>
    );
  }

  const fg = nowcast.kind === "ongoing" ? palette.accent : palette.warn;
  const raw = `▔ ${describeNowcast(nowcast)}`;
  const sentence = width === undefined ? raw : middleTruncate(raw, width);

  const strip =
    width === undefined || !forecast || !nowUtc
      ? null
      : stripFor(upcomingPrecipSeries(forecast, nowUtc), width);

  if (!strip) return <text fg={fg}>{sentence}</text>;

  return (
    <box flexDirection="column">
      <text fg={fg}>{sentence}</text>
      <text fg={fg}>{strip}</text>
    </box>
  );
});
