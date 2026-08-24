export interface KeymapApi {
  quit(): void;
  activeSlug(): string | null;
  refresh(slug: string | null): void;
  cycleLocation(delta: 1 | -1): void;
  toggleUnits(): void;
  helpOpen(): boolean;
  toggleHelp(): void;
}

/**
 * Central key handler. "/" is intentionally unmapped for M2: search lands in
 * M4, so the key is a silent no-op rather than an error.
 */
export function handleKey(name: string, api: KeymapApi): void {
  switch (name) {
    case "q":
      api.quit();
      break;
    case "escape":
      if (api.helpOpen()) {
        api.toggleHelp();
      } else {
        api.quit();
      }
      break;
    case "r":
      api.refresh(api.activeSlug());
      break;
    case "[":
      api.cycleLocation(-1);
      break;
    case "]":
      api.cycleLocation(1);
      break;
    case "u":
      api.toggleUnits();
      break;
    case "?":
      api.toggleHelp();
      break;
    default:
      break;
  }
}
