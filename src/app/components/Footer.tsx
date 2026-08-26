import { usePalette } from "../../theme/tokens";
import type { Tier } from "../../viewport/breakpoints";

interface FooterProps {
  tier: Tier;
}

// u units is trimmed below lg so ↑↓ scroll fits the 68/48-col floors; the help overlay still documents it.
const HINTS_FULL =
  "/ search · r refresh · d del×2 · u units · [ ] locations · ↑↓ scroll · ? help · q quit";
const HINTS_MD = "/ search · r refresh · d del×2 · ↑↓ scroll · ? help · q quit";
const HINTS_SM = "r refresh · ↑↓ scroll · ? help · q quit";
const HINTS_XS = "r u ? q";

export function footerText(tier: Tier): string {
  if (tier === "xs") return HINTS_XS;
  if (tier === "sm") return HINTS_SM;
  if (tier === "md") return HINTS_MD;
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
