import { truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

interface HelpOverlayProps {
  width: number;
  height: number;
  providerLabel: string;
}

export const HELP_BOX_WIDTH = 46;
const HELP_BOX_HEIGHT = 12;

const HELP_LINES: { text: string; dim?: boolean }[] = [
  { text: "q quit        r refresh      u units" },
  { text: "[ ] prev/next  1-9 jump  ? toggle help" },
  { text: "l locations  j/k focus  enter open (lg)" },
  { text: "s default  J/K reorder (lg)  ↑↓ scroll" },
  { text: "/ search     d delete (press twice)", dim: true },
  { text: "esc close / clear focus" },
];

export function HelpOverlay({ width, height, providerLabel }: HelpOverlayProps) {
  const palette = usePalette();
  const boxWidth = Math.max(1, Math.min(HELP_BOX_WIDTH, width >= 32 ? width - 2 : width));
  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = Math.max(0, Math.floor((height - HELP_BOX_HEIGHT) / 2));
  const clip = (line: string) => truncateCells(line, Math.max(1, boxWidth - 3));
  const lines: { text: string; dim?: boolean }[] = [
    ...HELP_LINES,
    { text: `data by ${providerLabel} · MIT licensed`, dim: true },
  ];

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
      {lines.map(({ text, dim }) =>
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
