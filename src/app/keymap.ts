export interface KeymapApi {
  quit(): void;
  activeSlug(): string | null;
  refresh(slug: string | null): void;
  cycleLocation(delta: 1 | -1): void;
  toggleUnits(): void;
  helpOpen(): boolean;
  toggleHelp(): void;
  searchOpen(): boolean;
  openSearch(): void;
  deleteArmed(): boolean;
  armDelete(): void;
  disarmDelete(): void;
  deleteActive(): void;
}

/**
 * While the search overlay is modal it owns the keyboard entirely: printable
 * keys must reach the input (not "d"/"q"/"u" actions) and escape must close
 * the overlay rather than quit.
 */
export function handleKey(name: string, api: KeymapApi): void {
  if (api.searchOpen()) return;
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
    case "/":
      api.openSearch();
      break;
    case "d":
      if (api.deleteArmed()) {
        api.deleteActive();
      } else {
        api.armDelete();
      }
      break;
    default:
      break;
  }
}
