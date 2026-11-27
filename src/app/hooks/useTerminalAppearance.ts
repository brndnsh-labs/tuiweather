import { useRenderer } from "@opentui/react";
import { useEffect, useState } from "react";
import {
  appearanceFromBackground,
  appearancesEqual,
  FALLBACK_APPEARANCE,
  type TerminalAppearance,
} from "../../theme/detect";

export function useTerminalAppearance(
  appearancePromise: Promise<TerminalAppearance>,
  followPalette: boolean,
): TerminalAppearance {
  const [appearance, setAppearance] = useState<TerminalAppearance>(FALLBACK_APPEARANCE);
  const renderer = useRenderer();
  useEffect(() => {
    let cancelled = false;
    let liveSeen = false;
    const apply = (next: TerminalAppearance) => {
      if (cancelled || renderer.isDestroyed) return;
      try {
        setAppearance((prev) => (appearancesEqual(prev, next) ? prev : next));
      } catch {}
    };
    appearancePromise
      .then((detected) => {
        if (!liveSeen) apply(detected);
      })
      .catch(() => undefined);
    const onPalette = (colors: { defaultBackground?: string | null } | null | undefined) => {
      const background = colors?.defaultBackground;
      if (!background) return;
      liveSeen = true;
      apply(appearanceFromBackground(background));
    };
    if (followPalette) renderer.on("palette", onPalette);
    return () => {
      cancelled = true;
      if (followPalette) renderer.off("palette", onPalette);
    };
  }, [appearancePromise, followPalette, renderer]);
  return appearance;
}
