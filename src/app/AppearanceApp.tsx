import { useRenderer } from "@opentui/react";
import { useEffect, useState } from "react";
import { appearancesEqual, FALLBACK_APPEARANCE, type TerminalAppearance } from "../theme/detect";
import { App } from "./App";
import type { WeatherStore } from "./store";

interface AppearanceAppProps {
  initialSlug?: string;
  appearancePromise: Promise<TerminalAppearance>;
  store?: WeatherStore;
}

export function AppearanceApp({ initialSlug, appearancePromise, store }: AppearanceAppProps) {
  const [appearance, setAppearance] = useState<TerminalAppearance>(FALLBACK_APPEARANCE);
  const renderer = useRenderer();
  useEffect(() => {
    let cancelled = false;
    appearancePromise
      .then((detected) => {
        if (cancelled) return;
        if (renderer.isDestroyed) return;
        try {
          setAppearance((prev) => (appearancesEqual(prev, detected) ? prev : detected));
        } catch {}
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appearancePromise, renderer]);
  return <App store={store} initialSlug={initialSlug} appearance={appearance} />;
}
