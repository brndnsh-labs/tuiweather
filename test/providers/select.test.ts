import { describe, expect, test } from "bun:test";
import { NWS_PROVIDER_ID } from "../../src/lib/providers/nws/client";
import { OPENMETEO_PROVIDER_ID } from "../../src/lib/providers/openmeteo/client";
import { selectProvider } from "../../src/lib/providers/select";
import { PROVIDER_IDS } from "../../src/lib/providers/types";

describe("selectProvider", () => {
  test("returns the open-meteo implementation for the openmeteo id", () => {
    const provider = selectProvider("openmeteo");
    expect(provider.id).toBe(OPENMETEO_PROVIDER_ID);
    expect(typeof provider.getForecast).toBe("function");
    expect(typeof provider.getAirQuality).toBe("function");
  });

  test("returns the NWS implementation for the nws id, without air quality", () => {
    const provider = selectProvider("nws");
    expect(provider.id).toBe(NWS_PROVIDER_ID);
    expect(typeof provider.getForecast).toBe("function");
    expect(provider.getAirQuality).toBeUndefined();
  });

  test("the two providers are distinct instances with distinct ids", () => {
    expect(selectProvider("openmeteo")).not.toBe(selectProvider("nws"));
  });

  test("PROVIDER_IDS matches the providers each module exports", () => {
    expect(PROVIDER_IDS).toContain(OPENMETEO_PROVIDER_ID);
    expect(PROVIDER_IDS).toContain(NWS_PROVIDER_ID);
    for (const id of PROVIDER_IDS) {
      expect(selectProvider(id).id).toBe(id);
    }
  });
});
