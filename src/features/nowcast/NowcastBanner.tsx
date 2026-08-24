import { describeNowcast, type Nowcast } from "../../lib/weather/derive";
import { usePalette } from "../../theme/tokens";

interface NowcastBannerProps {
  nowcast: Nowcast;
  hideWhenDry?: boolean;
  width?: number;
}

function middleTruncate(text: string, width: number): string {
  if (text.length <= width) return text;
  const keep = Math.max(1, width - 1);
  const head = Math.floor(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function NowcastBanner({ nowcast, hideWhenDry = false, width }: NowcastBannerProps) {
  const palette = usePalette();

  if (nowcast.kind === "dry") {
    if (hideWhenDry) return null;
    return (
      <text fg={palette.fgDim}>{middleTruncate(`▔ ${describeNowcast(nowcast)}`, width ?? 80)}</text>
    );
  }

  const fg = nowcast.kind === "ongoing" ? palette.accent : palette.warn;
  const raw = `▔ ${describeNowcast(nowcast)}`;
  return <text fg={fg}>{width === undefined ? raw : middleTruncate(raw, width)}</text>;
}
