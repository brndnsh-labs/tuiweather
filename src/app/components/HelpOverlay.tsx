import { usePalette } from "../../theme/tokens";

interface HelpOverlayProps {
  width: number;
  height: number;
}

export const HELP_BOX_WIDTH = 46;
const HELP_BOX_HEIGHT = 10;

export function HelpOverlay({ width, height }: HelpOverlayProps) {
  const palette = usePalette();
  const left = Math.max(0, Math.floor((width - HELP_BOX_WIDTH) / 2));
  const top = Math.max(0, Math.floor((height - HELP_BOX_HEIGHT) / 2));

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={HELP_BOX_WIDTH}
      zIndex={10}
      border
      borderColor={palette.accent}
      backgroundColor={palette.surface}
      title="keys"
      flexDirection="column"
    >
      <text fg={palette.fg} bg={palette.surface}>
        {"q quit        r refresh      u units"}
      </text>
      <text fg={palette.fg} bg={palette.surface}>
        {"[ ] prev/next location   ? toggle help"}
      </text>
      <text fg={palette.fg} bg={palette.surface}>
        {"↑↓ scroll"}
      </text>
      <text fg={palette.fgDim} bg={palette.surface}>
        {"/ search     d delete (press twice)"}
      </text>
      <text fg={palette.fg} bg={palette.surface}>
        {"esc close"}
      </text>
      <text fg={palette.fgDim} bg={palette.surface}>
        {"data by open-meteo.com · MIT licensed"}
      </text>
    </box>
  );
}
