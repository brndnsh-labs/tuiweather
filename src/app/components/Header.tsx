import {
  displayWidth,
  formatClock,
  formatDayDate,
  type TimeFormat,
  truncateCells,
} from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

export function formatUpdatedAgo(fetchedAtMs: number, nowMs: number): string {
  const deltaMs = nowMs - fetchedAtMs;
  if (deltaMs < 0) return "synced just now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 90) return "synced just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `synced ${days}d ago`;
}

interface HeaderProps {
  label: string;
  coords?: { latitude: number; longitude: number } | undefined;
  clockUtc?: string | undefined;
  utcOffsetSeconds?: number | undefined;
  timeFormat: TimeFormat;
  tier?: "xs" | "sm" | "md" | "lg" | undefined;
  fetchedAtMs?: number | undefined;
  stale?: boolean | undefined;
  nowMs?: number | undefined;
  width?: number | undefined;
}

export function Header({
  label,
  coords,
  clockUtc,
  utcOffsetSeconds = 0,
  timeFormat,
  tier,
  fetchedAtMs,
  stale = false,
  nowMs = Date.now(),
  width,
}: HeaderProps) {
  const palette = usePalette();
  const budget = Math.max(1, (width ?? 100) - 1);

  if (tier === "sm" || tier === "xs") {
    const clock =
      clockUtc !== undefined ? formatClock(clockUtc, utcOffsetSeconds, timeFormat) : "--:--";
    const date =
      tier === "sm" && clockUtc !== undefined
        ? formatDayDate(clockUtc, utcOffsetSeconds, "short")
        : undefined;
    const line = [label, date, clock].filter((part) => part !== undefined).join(" · ");
    const clipped = width === undefined ? line : truncateCells(line, Math.max(1, width - 1));
    return (
      <box flexDirection="column" height={tier === "xs" ? 1 : 2} flexShrink={0}>
        <text fg={palette.fg} height={1}>
          <b>{clipped}</b>
        </text>
        {tier === "sm" ? (
          <text fg={palette.accent} height={1}>
            {truncateCells("tuiweather / your window outside", budget)}
          </text>
        ) : null}
      </box>
    );
  }

  const clock = clockUtc === undefined ? "" : formatClock(clockUtc, utcOffsetSeconds, timeFormat);
  const date = clockUtc === undefined ? "" : formatDayDate(clockUtc, utcOffsetSeconds, "long");
  const right = `${date}  ${clock}`.trim();
  const brand = "tuiweather / ";
  const name = truncateCells(label, Math.max(1, budget - brand.length - displayWidth(right) - 2));
  const gap = " ".repeat(
    Math.max(1, budget - brand.length - displayWidth(name) - displayWidth(right)),
  );
  const metadata = [
    coords ? `${coords.latitude.toFixed(1)}°, ${coords.longitude.toFixed(1)}°` : null,
    fetchedAtMs === undefined ? null : formatUpdatedAgo(fetchedAtMs, nowMs),
    stale ? "stale" : null,
  ]
    .filter((part) => part !== null)
    .join("  ·  ");
  return (
    <box flexDirection="column" height={2} flexShrink={0}>
      <text fg={palette.fg} height={1}>
        <span fg={palette.accent}>{brand}</span>
        <b>{name}</b>
        {gap}
        <span fg={palette.fgDim}>{right}</span>
      </text>
      <text fg={stale ? palette.warn : palette.fgDim} height={1}>
        {truncateCells(metadata, budget)}
      </text>
    </box>
  );
}
