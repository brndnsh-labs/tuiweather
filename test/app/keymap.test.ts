import { describe, expect, test } from "bun:test";
import { handleKey, type KeymapApi } from "../../src/app/keymap";

function makeApi(overrides: Partial<Record<keyof KeymapApi, unknown>> = {}): KeymapApi & {
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const inc = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const base: KeymapApi = {
    quit: () => inc("quit"),
    activeSlug: () => "portland",
    refresh: () => inc("refresh"),
    cycleLocation: () => inc("cycleLocation"),
    toggleUnits: () => inc("toggleUnits"),
    helpOpen: () => false,
    toggleHelp: () => inc("toggleHelp"),
    searchOpen: () => false,
    openSearch: () => inc("openSearch"),
    locationsOpen: () => false,
    openLocations: () => inc("openLocations"),
    deleteArmed: () => false,
    armDelete: () => inc("armDelete"),
    disarmDelete: () => inc("disarmDelete"),
    deleteActive: () => inc("deleteActive"),
    locations: () => ["portland", "london"],
    switchLocation: () => inc("switchLocation"),
    focusedSlug: () => null,
    setFocused: () => inc("setFocused"),
    isLg: () => false,
    setDefault: () => inc("setDefault"),
    moveLocation: () => inc("moveLocation"),
  };
  for (const [k, v] of Object.entries(overrides)) {
    // @ts-expect-error dynamic override
    base[k] = v;
  }
  return Object.assign(base, { calls });
}

describe("keymap help modal", () => {
  test("with helpOpen=true, pressing d twice calls deleteActive zero times", () => {
    const api = makeApi({
      helpOpen: () => true,
      deleteArmed: () => false,
    });
    handleKey("d", api);
    handleKey("d", api);
    expect(api.calls.deleteActive ?? 0).toBe(0);
    expect(api.calls.armDelete ?? 0).toBe(0);
  });

  test("with helpOpen=true, pressing d twice does not arm then delete even when armed", () => {
    const api = makeApi({
      helpOpen: () => true,
      deleteArmed: () => true,
    });
    handleKey("d", api);
    handleKey("d", api);
    expect(api.calls.deleteActive ?? 0).toBe(0);
  });

  test("with helpOpen=true, pressing r calls refresh zero times", () => {
    const api = makeApi({ helpOpen: () => true });
    handleKey("r", api);
    expect(api.calls.refresh ?? 0).toBe(0);
  });

  test("with helpOpen=true, pressing escape calls toggleHelp", () => {
    const api = makeApi({ helpOpen: () => true });
    handleKey("escape", api);
    expect(api.calls.toggleHelp).toBe(1);
    expect(api.calls.quit ?? 0).toBe(0);
  });

  test("with helpOpen=true, escape with focus set clears focus not help", () => {
    const api = makeApi({
      helpOpen: () => true,
      focusedSlug: () => "portland",
    });
    handleKey("escape", api);
    expect(api.calls.setFocused).toBe(1);
    expect(api.calls.toggleHelp ?? 0).toBe(0);
  });

  test("help modal blocks q, u, /, numbers", () => {
    const api = makeApi({ helpOpen: () => true });
    handleKey("q", api);
    handleKey("u", api);
    handleKey("/", api);
    handleKey("1", api);
    expect(api.calls.quit ?? 0).toBe(0);
    expect(api.calls.toggleUnits ?? 0).toBe(0);
    expect(api.calls.openSearch ?? 0).toBe(0);
    expect(api.calls.switchLocation ?? 0).toBe(0);
  });

  test("searchOpen still blocks keys and escape is no-op", () => {
    const api = makeApi({ searchOpen: () => true });
    handleKey("r", api);
    handleKey("d", api);
    expect(api.calls.refresh ?? 0).toBe(0);
    expect(api.calls.armDelete ?? 0).toBe(0);
    handleKey("escape", api);
    expect(api.calls.quit ?? 0).toBe(0);
    expect(api.calls.toggleHelp ?? 0).toBe(0);
  });

  test("l opens the locations overlay when no modal is open", () => {
    const api = makeApi();
    handleKey("l", api);
    expect(api.calls.openLocations).toBe(1);
  });

  test("locationsOpen blocks keys, numbers, and escape is no-op", () => {
    const api = makeApi({ locationsOpen: () => true });
    handleKey("r", api);
    handleKey("d", api);
    handleKey("l", api);
    handleKey("1", api);
    handleKey("[", api);
    expect(api.calls.refresh ?? 0).toBe(0);
    expect(api.calls.armDelete ?? 0).toBe(0);
    expect(api.calls.openLocations ?? 0).toBe(0);
    expect(api.calls.switchLocation ?? 0).toBe(0);
    expect(api.calls.cycleLocation ?? 0).toBe(0);
    handleKey("escape", api);
    expect(api.calls.quit ?? 0).toBe(0);
    expect(api.calls.toggleHelp ?? 0).toBe(0);
  });

  test("without modal, d arms and r refreshes normally", () => {
    const api = makeApi({ helpOpen: () => false, searchOpen: () => false });
    handleKey("d", api);
    expect(api.calls.armDelete).toBe(1);
    handleKey("r", api);
    expect(api.calls.refresh).toBe(1);
  });
});
