import { describe, expect, test } from "bun:test";
import { handleKey, type KeymapApi } from "../../src/app/keymap";

function makeApi(overrides: Partial<Record<keyof KeymapApi, unknown>> = {}): KeymapApi & {
  calls: Record<string, number>;
  focusedArgs: (string | null)[];
} {
  const calls: Record<string, number> = {};
  const focusedArgs: (string | null)[] = [];
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
    dayDetailOpen: () => false,
    closeDayDetail: () => inc("closeDayDetail"),
    moveDayCursor: () => inc("moveDayCursor"),
    openDayDetail: () => inc("openDayDetail"),
    moveDailyPage: () => inc("moveDailyPage"),
    hourlyInspectOpen: () => false,
    toggleHourlyInspect: () => inc("toggleHourlyInspect"),
    exitHourlyInspect: () => inc("exitHourlyInspect"),
    moveHourlyInspect: () => inc("moveHourlyInspect"),
    toggleNowcastExpanded: () => inc("toggleNowcastExpanded"),
    deleteArmed: () => false,
    armDelete: () => inc("armDelete"),
    disarmDelete: () => inc("disarmDelete"),
    deleteActive: () => inc("deleteActive"),
    locations: () => ["portland", "london"],
    switchLocation: () => inc("switchLocation"),
    focusedSlug: () => null,
    setFocused: (slug: string | null) => {
      inc("setFocused");
      focusedArgs.push(slug);
    },
    isLg: () => false,
    setDefault: () => inc("setDefault"),
    moveLocation: () => inc("moveLocation"),
  };
  for (const [k, v] of Object.entries(overrides)) {
    // @ts-expect-error dynamic override
    base[k] = v;
  }
  return Object.assign(base, { calls, focusedArgs });
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

  test("left/right move the day cursor and v opens the selected day", () => {
    const api = makeApi();
    handleKey("left", api);
    handleKey("right", api);
    handleKey("v", api);
    expect(api.calls.moveDayCursor).toBe(2);
    expect(api.calls.openDayDetail).toBe(1);
  });

  test("day detail is modal and escape closes it before other actions", () => {
    const api = makeApi({ dayDetailOpen: () => true });
    handleKey("r", api);
    handleKey("d", api);
    handleKey("v", api);
    expect(api.calls.refresh ?? 0).toBe(0);
    expect(api.calls.armDelete ?? 0).toBe(0);
    expect(api.calls.openDayDetail ?? 0).toBe(0);

    handleKey("escape", api);
    expect(api.calls.closeDayDetail).toBe(1);
    expect(api.calls.toggleHelp ?? 0).toBe(0);
  });

  test("i toggles hourly inspect", () => {
    const api = makeApi();
    handleKey("i", api);
    expect(api.calls.toggleHourlyInspect).toBe(1);
  });

  test("m toggles the nowcast expansion", () => {
    const api = makeApi();
    handleKey("m", api);
    handleKey("m", api);
    expect(api.calls.toggleNowcastExpanded).toBe(2);
  });

  test("help/search/locations/day-detail modals block m", () => {
    for (const overrides of [
      { helpOpen: () => true },
      { searchOpen: () => true },
      { locationsOpen: () => true },
      { dayDetailOpen: () => true },
    ] as const) {
      const api = makeApi(overrides);
      handleKey("m", api);
      expect(api.calls.toggleNowcastExpanded ?? 0).toBe(0);
    }
  });

  test("left/right route to moveHourlyInspect (not moveDayCursor) while inspect is open", () => {
    const api = makeApi({ hourlyInspectOpen: () => true });
    handleKey("left", api);
    handleKey("right", api);
    expect(api.calls.moveHourlyInspect).toBe(2);
    expect(api.calls.moveDayCursor ?? 0).toBe(0);
  });

  test("left/right route to moveDayCursor when inspect is closed", () => {
    const api = makeApi({ hourlyInspectOpen: () => false });
    handleKey("left", api);
    handleKey("right", api);
    expect(api.calls.moveDayCursor).toBe(2);
    expect(api.calls.moveHourlyInspect ?? 0).toBe(0);
  });

  test("escape exits hourly inspect before other modal checks, without closing day detail", () => {
    const api = makeApi({ hourlyInspectOpen: () => true, dayDetailOpen: () => false });
    handleKey("escape", api);
    expect(api.calls.exitHourlyInspect).toBe(1);
    expect(api.calls.closeDayDetail ?? 0).toBe(0);
    expect(api.calls.quit ?? 0).toBe(0);
  });

  test("day detail escape takes priority over hourly inspect", () => {
    const api = makeApi({ hourlyInspectOpen: () => true, dayDetailOpen: () => true });
    handleKey("escape", api);
    expect(api.calls.closeDayDetail).toBe(1);
    expect(api.calls.exitHourlyInspect ?? 0).toBe(0);
  });

  test("search/locations own their own escape handler, so hourly inspect defers to them", () => {
    const searchApi = makeApi({ hourlyInspectOpen: () => true, searchOpen: () => true });
    handleKey("escape", searchApi);
    expect(searchApi.calls.exitHourlyInspect ?? 0).toBe(0);

    const locationsApi = makeApi({ hourlyInspectOpen: () => true, locationsOpen: () => true });
    handleKey("escape", locationsApi);
    expect(locationsApi.calls.exitHourlyInspect ?? 0).toBe(0);
  });

  test("without modal, d arms and r refreshes normally", () => {
    const api = makeApi({ helpOpen: () => false, searchOpen: () => false });
    handleKey("d", api);
    expect(api.calls.armDelete).toBe(1);
    handleKey("r", api);
    expect(api.calls.refresh).toBe(1);
  });

  test("escape with nothing open is a no-op", () => {
    const api = makeApi();
    handleKey("escape", api);
    expect(api.calls.quit ?? 0).toBe(0);
    expect(api.calls.toggleHelp ?? 0).toBe(0);
    expect(api.calls.setFocused ?? 0).toBe(0);
  });

  test("escape clears focused slug", () => {
    const api = makeApi({ focusedSlug: () => "london" });
    handleKey("escape", api);
    expect(api.calls.setFocused).toBe(1);
    expect(api.focusedArgs).toEqual([null]);
    expect(api.calls.quit ?? 0).toBe(0);
    expect(api.calls.toggleHelp ?? 0).toBe(0);
  });

  test("q still quits when no modal is open", () => {
    const api = makeApi();
    handleKey("q", api);
    expect(api.calls.quit).toBe(1);
  });

  test(", and . page the daily list backward/forward", () => {
    const api = makeApi();
    handleKey(",", api);
    handleKey(".", api);
    handleKey(".", api);
    expect(api.calls.moveDailyPage).toBe(3);
  });

  test("help/search/locations/day-detail modals block , and .", () => {
    for (const overrides of [
      { helpOpen: () => true },
      { searchOpen: () => true },
      { locationsOpen: () => true },
      { dayDetailOpen: () => true },
    ] as const) {
      const api = makeApi(overrides);
      handleKey(",", api);
      handleKey(".", api);
      expect(api.calls.moveDailyPage ?? 0).toBe(0);
    }
  });
});
