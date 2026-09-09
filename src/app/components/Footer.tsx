import { truncateCells } from "../../lib/weather/format";
import { panelPalette } from "../../theme/palette";
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
  const palette = panelPalette(usePalette());
  const hints = footerText(tier, width).split(" · ");
  return (
    <box flexDirection="row" backgroundColor={palette.surface} height={1} flexShrink={0}>
      <text fg={palette.fgDim} height={1}>
        {hints.map((hint, index) => {
          const split = hint.indexOf(" ");
          const key = split === -1 ? hint : hint.slice(0, split);
          const label = split === -1 ? "" : hint.slice(split);
          return (
            <span key={hint}>
              {index > 0 ? " · " : ""}
              <span fg={palette.accent}>
                <b>{key}</b>
              </span>
              {label}
            </span>
          );
        })}
      </text>
    </box>
  );
}
