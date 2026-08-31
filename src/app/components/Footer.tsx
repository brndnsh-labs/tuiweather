import { truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";
import type { Tier } from "../../viewport/breakpoints";

interface FooterProps {
  tier: Tier;
  width: number;
}

// u units is trimmed below lg so ↑↓ scroll fits the 68/48-col floors; the help overlay still documents it.
const HINTS_FULL =
  "←→ day · v view · / search · r refresh · u units · [ ]/l locations · ↑↓ scroll · ? help · q quit";
const HINTS_MD = "←→ day · v view · r refresh · l locations · ↑↓ scroll · ? help";
const HINTS_SM = "v day · r refresh · ↑↓ scroll · ? · q quit";
const HINTS_XS = "v r u ? q";

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
