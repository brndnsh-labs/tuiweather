import type { TerminalAppearance } from "../theme/detect";
import { App } from "./App";
import { useTerminalAppearance } from "./hooks/useTerminalAppearance";
import type { WeatherStore } from "./store";

interface AppearanceAppProps {
  initialSlug?: string;
  appearancePromise: Promise<TerminalAppearance>;
  followPalette?: boolean;
  store?: WeatherStore;
}

export function AppearanceApp({
  initialSlug,
  appearancePromise,
  followPalette = false,
  store,
}: AppearanceAppProps) {
  const appearance = useTerminalAppearance(appearancePromise, followPalette);
  return <App store={store} initialSlug={initialSlug} appearance={appearance} />;
}
