import { usePalette } from "../../theme/tokens";

interface HelpOverlayProps {
  width: number;
  height: number;
}

export const HELP_BOX_WIDTH = 46;
const HELP_BOX_HEIGHT = 9;

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
      title="keys"
      flexDirection="column"
    >
      <text fg={palette.fg}>{"q quit        r refresh      u units"}</text>
      <text fg={palette.fg}>{"[ ] prev/next location   ? toggle help"}</text>
      <text fg={palette.fgDim}>{"/ search (coming soon)"}</text>
      <text fg={palette.fg}>{"esc close"}</text>
    </box>
  );
}
