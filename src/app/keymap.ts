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
  locationsOpen(): boolean;
  openLocations(): void;
  dayDetailOpen(): boolean;
  closeDayDetail(): void;
  moveDayCursor(delta: 1 | -1): void;
  openDayDetail(): void;
  deleteArmed(): boolean;
  armDelete(): void;
  disarmDelete(): void;
  deleteActive(): void;
  locations(): string[];
  switchLocation(slug: string): void;
  focusedSlug(): string | null;
  setFocused(slug: string | null): void;
  isLg(): boolean;
  setDefault(slug: string): void;
  moveLocation(slug: string, delta: 1 | -1): void;
}

/**
 * While the search overlay is modal it owns the keyboard entirely: printable
 * keys must reach the input (not "d"/"q"/"u" actions) and escape must close
 * the overlay rather than quit.
 */
export function handleKey(
  nameOrEvent: string | { name: string; shift?: boolean },
  api: KeymapApi,
): void {
  const name = typeof nameOrEvent === "string" ? nameOrEvent : nameOrEvent.name;
  const shift = typeof nameOrEvent === "string" ? false : !!nameOrEvent.shift;
  if (name === "escape") {
    if (api.dayDetailOpen()) {
      api.closeDayDetail();
      return;
    }
    if (api.searchOpen()) return;
    if (api.locationsOpen()) return;
    if (api.focusedSlug() !== null) {
      api.setFocused(null);
      return;
    }
    if (api.helpOpen()) {
      api.toggleHelp();
      return;
    }
    return;
  }
  if (api.searchOpen() || api.locationsOpen() || api.helpOpen() || api.dayDetailOpen()) return;
  switch (name) {
    case "q":
      api.quit();
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
    case "l":
      api.openLocations();
      break;
    case "left":
      api.moveDayCursor(-1);
      break;
    case "right":
      api.moveDayCursor(1);
      break;
    case "v":
      api.openDayDetail();
      break;
    case "d":
      if (api.deleteArmed()) {
        api.deleteActive();
      } else {
        api.armDelete();
      }
      break;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9": {
      const idx = Number.parseInt(name, 10) - 1;
      const slugs = api.locations();
      if (idx >= 0 && idx < slugs.length) {
        const target = slugs[idx];
        if (target) api.switchLocation(target);
      }
      break;
    }
    case "j": {
      if (shift) {
        if (!api.isLg()) break;
        const focused = api.focusedSlug();
        if (focused === null) break;
        api.moveLocation(focused, 1);
        break;
      }
      if (!api.isLg()) break;
      const slugs = api.locations();
      if (slugs.length === 0) break;
      const focused = api.focusedSlug();
      if (focused === null) {
        const first = slugs[0];
        if (first) api.setFocused(first);
      } else {
        const idx = slugs.indexOf(focused);
        if (idx === -1) {
          const first = slugs[0];
          if (first) api.setFocused(first);
        } else {
          const next = slugs[(idx + 1) % slugs.length];
          if (next) api.setFocused(next);
        }
      }
      break;
    }
    case "k": {
      if (shift) {
        if (!api.isLg()) break;
        const focused = api.focusedSlug();
        if (focused === null) break;
        api.moveLocation(focused, -1);
        break;
      }
      if (!api.isLg()) break;
      const slugs = api.locations();
      if (slugs.length === 0) break;
      const focused = api.focusedSlug();
      if (focused === null) {
        const last = slugs[slugs.length - 1];
        if (last) api.setFocused(last);
      } else {
        const idx = slugs.indexOf(focused);
        if (idx === -1) {
          const last = slugs[slugs.length - 1];
          if (last) api.setFocused(last);
        } else {
          const next = slugs[(idx - 1 + slugs.length) % slugs.length];
          if (next) api.setFocused(next);
        }
      }
      break;
    }
    case "enter":
    case "return": {
      if (!api.isLg()) break;
      const focused = api.focusedSlug();
      if (focused === null) break;
      api.switchLocation(focused);
      break;
    }
    case "s": {
      const target = (api.isLg() ? api.focusedSlug() : null) ?? api.activeSlug();
      if (target === null) break;
      api.setDefault(target);
      break;
    }
    case "J": {
      if (!api.isLg()) break;
      const focused = api.focusedSlug();
      if (focused === null) break;
      api.moveLocation(focused, 1);
      break;
    }
    case "K": {
      if (!api.isLg()) break;
      const focused = api.focusedSlug();
      if (focused === null) break;
      api.moveLocation(focused, -1);
      break;
    }
    default:
      break;
  }
}
