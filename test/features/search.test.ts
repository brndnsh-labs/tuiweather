import { describe, expect, test } from "bun:test";
import { buildLocationEntry, slugifyCandidate } from "../../src/features/search/SearchOverlay";
import type { GeocodingResult } from "../../src/lib/providers/types";

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
