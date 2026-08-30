import { useEffect, useState } from "react";
import { displayWidth, truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;
const SPINNER_INTERVAL_MS = 120;

function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return <text>{SPINNER_FRAMES[frame] ?? "|"}</text>;
}

interface StatusAreaProps {
  loading: boolean;
  error: string | undefined;
  stale: boolean;
  deleteArm?: { label: string } | undefined;
  actionError?: string | undefined;
  width?: number | undefined;
}

export function deleteArmLine(label: string, width: number | undefined): string {
  const line = `press d again to delete ${label}`;
  const budget = width === undefined ? displayWidth(line) : Math.max(0, width - 1);
  return truncateCells(line, budget);
}

export function actionErrorLine(error: string, width: number | undefined): string {
  const budget = width === undefined ? displayWidth(error) : Math.max(0, width - 1);
  return truncateCells(error, budget);
}

export function StatusArea({
  loading,
  error,
  stale,
  deleteArm,
  actionError,
  width,
}: StatusAreaProps) {
  const palette = usePalette();

  if (deleteArm !== undefined) {
    return (
      <box flexDirection="row">
        <text fg={palette.warn}>{deleteArmLine(deleteArm.label, width)}</text>
      </box>
    );
  }

  if (actionError !== undefined) {
    return (
      <box flexDirection="row">
        <text fg={palette.danger}>{actionErrorLine(actionError, width)}</text>
      </box>
    );
  }

  if (loading) {
    return (
      <box flexDirection="row" gap={1}>
        <Spinner />
        <text fg={palette.accent}>syncing…</text>
      </box>
    );
  }

  if (error !== undefined) {
    return (
      <box border borderColor={palette.danger} flexDirection="column" gap={0} title="error">
        <text fg={palette.danger}>{error}</text>
        <text fg={palette.fgDim}>press r to retry</text>
      </box>
    );
  }

  if (stale) {
    return (
      <box flexDirection="row">
        <text fg={palette.warn}>showing cached data</text>
      </box>
    );
  }

  return null;
}
