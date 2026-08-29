import { describe, expect, test } from "bun:test";
import {
  buildLocationEntry,
  resultLine,
  slugifyCandidate,
} from "../../src/features/search/SearchOverlay";
import type { GeocodingResult } from "../../src/lib/providers/types";
import { displayWidth } from "../../src/lib/weather/format";

function geo(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    id: 1,
    name: "Portland",
    latitude: 45.52,
    longitude: -122.68,
    admin1: "Oregon",
    country: "United States",
    country_code: "US",
    ...overrides,
  };
}

describe("slugifyCandidate", () => {
  test("prefers admin1 and is unchanged after label fix", () => {
    expect(slugifyCandidate("Portland", "Oregon", "US")).toBe("portland-oregon-us");
    expect(slugifyCandidate("Portland", "Maine", "US")).toBe("portland-maine-us");
    expect(slugifyCandidate("Portland", undefined, "US")).toBe("portland-us");
    expect(slugifyCandidate("Portland", "Oregon", undefined)).toBe("portland-oregon");
  });
});

describe("buildLocationEntry", () => {
  test("two Portlands with same country_code but different admin1 produce distinct Oregon/Maine labels", () => {
    const oregon = geo({ id: 1, admin1: "Oregon", country_code: "US" });
    const maine = geo({
      id: 2,
      admin1: "Maine",
      country_code: "US",
      latitude: 43.66,
      longitude: -70.26,
    });

    const oregonEntry = buildLocationEntry(oregon, []);
    const maineEntry = buildLocationEntry(maine, []);

    expect(oregonEntry.label).toBe("Portland, Oregon");
    expect(maineEntry.label).toBe("Portland, Maine");
    expect(oregonEntry.label).not.toBe(maineEntry.label);
  });

  test("slug still prefers admin1 so slugs remain distinct and unchanged", () => {
    const oregon = geo({ id: 1, admin1: "Oregon", country_code: "US" });
    const maine = geo({ id: 2, admin1: "Maine", country_code: "US" });

    const oregonEntry = buildLocationEntry(oregon, []);
    const maineEntry = buildLocationEntry(maine, [oregonEntry.slug]);

    expect(oregonEntry.slug).toBe("portland-oregon-us");
    expect(maineEntry.slug).toBe("portland-maine-us");
    expect(oregonEntry.slug).not.toBe(maineEntry.slug);
  });

  test("falls back to country_code when admin1 missing", () => {
    const result = geo({ admin1: undefined, country_code: "IS", name: "Reykjavik" });
    const entry = buildLocationEntry(result, []);
    expect(entry.label).toBe("Reykjavik, IS");
    expect(entry.slug).toBe(slugifyCandidate("Reykjavik", undefined, "IS"));
  });

  test("uses name only when both admin1 and country_code missing", () => {
    const result = geo({ admin1: undefined, country_code: undefined, name: "Nowhere" });
    const entry = buildLocationEntry(result, []);
    expect(entry.label).toBe("Nowhere");
  });

  test("prefers admin1 over country_code even when both present", () => {
    const result = geo({ admin1: "California", country_code: "US", name: "Los Angeles" });
    const entry = buildLocationEntry(result, []);
    expect(entry.label).toBe("Los Angeles, California");
    expect(entry.label).not.toContain(", US");
  });
});

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("buildLocationEntry label cap", () => {
  test("caps labels at 80 cells", () => {
    const result = geo({ name: "🏙".repeat(100), admin1: undefined, country_code: undefined });
    const entry = buildLocationEntry(result, []);
    expect(displayWidth(entry.label)).toBeLessThanOrEqual(80);
  });

  test("never splits a surrogate pair when truncating", () => {
    const result = geo({ name: "🏙️".repeat(100), admin1: undefined, country_code: undefined });
    const entry = buildLocationEntry(result, []);
    expect(entry.label.length).toBeGreaterThan(0);
    expect(LONE_SURROGATE.test(entry.label)).toBe(false);
  });

  test("leaves short labels untouched including wide glyphs", () => {
    const result = geo({ name: "東京🌆", admin1: undefined, country_code: undefined });
    const entry = buildLocationEntry(result, []);
    expect(entry.label).toBe("東京🌆");
  });
});

describe("resultLine", () => {
  test("stays within the column budget for ASCII names", () => {
    const line = resultLine(geo(), true, 40);
    expect(displayWidth(line)).toBeLessThanOrEqual(40);
  });

  test("stays within the column budget for emoji/CJK names", () => {
    const result = geo({ name: "🏙️Honolulu🏙️Honolulu", admin1: "HonoluluHonolulu" });
    for (const width of [20, 30, 40, 60]) {
      expect(displayWidth(resultLine(result, true, width))).toBeLessThanOrEqual(width);
    }
  });

  test("pads to exactly the budget on the right when the name is short", () => {
    const line = resultLine(
      geo({ name: "AB", admin1: undefined, country_code: undefined }),
      false,
      30,
    );
    expect(displayWidth(line)).toBe(30);
  });

  test("truncating the left column never yields a lone surrogate", () => {
    const result = geo({ name: "🏙️".repeat(50), admin1: "StateStateState" });
    const line = resultLine(result, true, 30);
    expect(LONE_SURROGATE.test(line)).toBe(false);
    expect(displayWidth(line)).toBeLessThanOrEqual(30);
  });
});
