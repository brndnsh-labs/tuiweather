import {
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
      <box flexDirection="row">
        <text fg={palette.fg}>{clipped}</text>
      </box>
    );
  }

  return (
    <box flexDirection="row" gap={2}>
      <text fg={palette.accent}>{label}</text>
      {coords ? (
        <text fg={palette.fgDim}>
          {`${coords.latitude.toFixed(1)}°, ${coords.longitude.toFixed(1)}°`}
        </text>
      ) : null}
      {clockUtc !== undefined ? (
        <text fg={palette.fgDim}>{formatDayDate(clockUtc, utcOffsetSeconds, "long")}</text>
      ) : null}
      {fetchedAtMs !== undefined ? (
        <text fg={palette.fgDim}>{formatUpdatedAgo(fetchedAtMs, nowMs)}</text>
      ) : null}
      {stale ? <text fg={palette.warn}>stale</text> : null}
    </box>
  );
}
