import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  apiErrorBodySchema,
  forecastResponseSchema,
  geocodingResponseSchema,
} from "../../src/lib/providers/openmeteo/schemas";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "openmeteo");

async function loadFixture(name: string) {
  return Bun.file(join(FIXTURES, `${name}.json`)).json();
}

describe("forecastResponseSchema", () => {
  test.each(["portland", "tokyo"])("accepts the recorded %s fixture", async (name) => {
    const body = await loadFixture(name);
    const parsed = forecastResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  test("routes an API error body into the typed failure shape", () => {
    const parsed = apiErrorBodySchema.safeParse({
      error: true,
      reason: "Latitude must be numeric",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe("Latitude must be numeric");
  });

  test("rejects an error body as a success payload", () => {
    const parsed = forecastResponseSchema.safeParse({ error: true, reason: "nope" });
    expect(parsed.success).toBe(false);
  });

  test("rejects hourly series that drift out of parallel with time", async () => {
    const body = await loadFixture("portland");
    body.hourly.temperature_2m.push(null);
    const parsed = forecastResponseSchema.safeParse(body);
    expect(parsed.success).toBe(false);
  });

  test("rejects a missing required hourly series", async () => {
    const body = await loadFixture("portland");
    delete body.hourly.wind_speed_10m;
    const parsed = forecastResponseSchema.safeParse(body);
    expect(parsed.success).toBe(false);
  });
});

describe("geocodingResponseSchema", () => {
  test("accepts a results payload and an empty payload", () => {
    expect(
      geocodingResponseSchema.safeParse({
        results: [{ id: 1, name: "X", latitude: 0, longitude: 0 }],
        generationtime_ms: 0.1,
      }).success,
    ).toBe(true);
    expect(geocodingResponseSchema.safeParse({ generationtime_ms: 0.1 }).success).toBe(true);
  });

  test.each([
    ["latitude", 90.0001],
    ["latitude", -90.0001],
    ["longitude", 180.0001],
    ["longitude", -180.0001],
  ])("rejects an out-of-range %s of %s", (field, value) => {
    const result = geocodingResponseSchema.safeParse({
      results: [{ id: 1, name: "X", latitude: 0, longitude: 0, [field]: value }],
      generationtime_ms: 0.1,
    });
    expect(result.success).toBe(false);
  });

  test("accepts coordinates at the range edges", () => {
    expect(
      geocodingResponseSchema.safeParse({
        results: [{ id: 1, name: "X", latitude: 90, longitude: -180 }],
        generationtime_ms: 0.1,
      }).success,
    ).toBe(true);
  });
});
