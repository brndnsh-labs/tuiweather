import { useKeyboard } from "@opentui/react";
import { truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";
import type { WeatherStore } from "../store";

interface HelpOverlayProps {
  store: WeatherStore;
  width: number;
  height: number;
  providerLabel: string;
}

export const HELP_BOX_WIDTH = 46;
const HELP_BOX_HEIGHT = 13;

const HELP_LINES: { text: string; dim?: boolean }[] = [
  { text: "q quit        r refresh      u units" },
  { text: "← → select day  v inspect day" },
  { text: "i inspect hour  , . page days" },
  { text: "m expand nowcast timeline" },
  { text: "[ ] location  1-9 jump  ? toggle help" },
  { text: "l locations  j/k focus  enter open (lg)" },
  { text: "s default  J/K reorder (lg)  ↑↓ scroll" },
  { text: "/ search     d delete (press twice)", dim: true },
  { text: "o re-run setup", dim: true },
  { text: "esc close / clear focus" },
];

export function HelpOverlay({ store, width, height, providerLabel }: HelpOverlayProps) {
  const palette = usePalette();
  useKeyboard((key) => {
    if (key.name === "o" && !key.ctrl && !key.meta && !key.option && !key.shift) {
      store.getState().requestOnboarding();
    }
  });
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
