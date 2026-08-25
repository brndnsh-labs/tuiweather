import { formatClock } from "../../lib/weather/format";
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
  tier?: "xs" | "sm" | "md" | "lg" | undefined;
  fetchedAtMs?: number | undefined;
  stale?: boolean | undefined;
  nowMs?: number | undefined;
}

export function Header({
  label,
  coords,
  clockUtc,
  utcOffsetSeconds = 0,
  tier,
  fetchedAtMs,
  stale = false,
  nowMs = Date.now(),
}: HeaderProps) {
  const palette = usePalette();

  if (tier === "sm" || tier === "xs") {
    const clock = clockUtc !== undefined ? formatClock(clockUtc, utcOffsetSeconds) : "--:--";
    return (
      <box flexDirection="row">
        <text fg={palette.fg}>{`${label} · ${clock} · ${tier}`}</text>
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
      {fetchedAtMs !== undefined ? (
        <text fg={palette.fgDim}>{formatUpdatedAgo(fetchedAtMs, nowMs)}</text>
      ) : null}
      {stale ? <text fg={palette.warn}>stale</text> : null}
    </box>
  );
}
