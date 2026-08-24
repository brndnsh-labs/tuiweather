import { usePalette } from "../../theme/tokens";
import type { Tier } from "../../viewport/breakpoints";

interface FooterProps {
  tier: Tier;
}

const HINTS_FULL = "/ search · r refresh · u units · [ ] locations · ? help · q quit";
const HINTS_SM = "r refresh · u units · ? help · q quit";
const HINTS_XS = "r u ? q";

export function footerText(tier: Tier): string {
  if (tier === "xs") return HINTS_XS;
  if (tier === "sm") return HINTS_SM;
  return HINTS_FULL;
}

export function Footer({ tier }: FooterProps) {
  const palette = usePalette();
  return (
    <box flexDirection="row">
      <text fg={palette.fgDim}>{footerText(tier)}</text>
    </box>
  );
}
