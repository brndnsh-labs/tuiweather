import { truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";
import type { Tier } from "../../viewport/breakpoints";

interface FooterProps {
  tier: Tier;
  width: number;
}

// u units is trimmed below lg so ↑↓ scroll fits the 68/48-col floors; the help overlay still documents it.
const HINTS_FULL =
  "/ search · r refresh · d del×2 · u units · [ ] locations · ↑↓ scroll · ? help · q quit";
const HINTS_MD = "/ search · r refresh · d del×2 · ↑↓ scroll · ? help · q quit";
const HINTS_SM = "r refresh · ↑↓ scroll · ? help · q quit";
const HINTS_XS = "r u ? q";

export function footerText(tier: Tier, width: number): string {
  const hints =
    tier === "xs" ? HINTS_XS : tier === "sm" ? HINTS_SM : tier === "md" ? HINTS_MD : HINTS_FULL;
  return truncateCells(hints, Math.max(1, width - 3));
}

export function Footer({ tier, width }: FooterProps) {
  const palette = usePalette();
  return (
    <box flexDirection="row">
      <text fg={palette.fgDim}>{footerText(tier, width)}</text>
    </box>
  );
}
