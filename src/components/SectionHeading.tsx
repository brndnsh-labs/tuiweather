import { displayWidth, truncateCells } from "../lib/weather/format";
import { usePalette } from "../theme/tokens";

export function SectionHeading({ label, width }: { label: string; width: number }) {
  const palette = usePalette();
  const title = truncateCells(` ${label} `, Math.max(0, width - 3));
  const rule = "─".repeat(Math.max(0, width - displayWidth(title) - 3));
  return (
    <text height={1} fg={palette.border}>
      <span fg={palette.accent}>▰</span>
      <span fg={palette.fg}>
        <b>{title}</b>
      </span>
      {rule}
    </text>
  );
}
