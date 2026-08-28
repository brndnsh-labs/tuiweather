import { truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

interface HelpOverlayProps {
  width: number;
  height: number;
}

export const HELP_BOX_WIDTH = 46;
const HELP_BOX_HEIGHT = 10;

const HELP_LINES: { text: string; dim?: boolean }[] = [
  { text: "q quit        r refresh      u units" },
  { text: "[ ] prev/next location   ? toggle help" },
  { text: "↑↓ scroll" },
  { text: "/ search     d delete (press twice)", dim: true },
  { text: "esc close" },
  { text: "data by open-meteo.com · MIT licensed", dim: true },
];

export function HelpOverlay({ width, height }: HelpOverlayProps) {
  const palette = usePalette();
  const boxWidth = Math.max(1, Math.min(HELP_BOX_WIDTH, width >= 32 ? width - 2 : width));
  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = Math.max(0, Math.floor((height - HELP_BOX_HEIGHT) / 2));
  const clip = (line: string) => truncateCells(line, Math.max(1, boxWidth - 3));

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={boxWidth}
      zIndex={10}
      border
      borderColor={palette.accent}
      backgroundColor={palette.surface}
      title="keys"
      flexDirection="column"
    >
      {HELP_LINES.map(({ text, dim }) =>
        dim ? (
          <text key={text} fg={palette.fgDim} bg={palette.surface}>
            {clip(text)}
          </text>
        ) : (
          <text key={text} fg={palette.fg} bg={palette.surface}>
            {clip(text)}
          </text>
        ),
      )}
    </box>
  );
}
