import { describe, expect, test } from "bun:test";
import {
  NWS_ICON_CODES,
  nwsIconToCondition,
  nwsTextToCondition,
  nwsToCondition,
} from "../../../src/lib/providers/nws/conditions";

function icon(code: string): string {
  return `https://api.weather.gov/icons/land/day/${code}?size=small`;
}

describe("nws icon-code table", () => {
  test("covers every code that appears in the recorded fixtures", () => {
    for (const code of ["few", "sct", "bkn", "ovc", "fog", "rain_showers"]) {
      expect(NWS_ICON_CODES[code]).toBeDefined();
    }
  });

  test("maps sky-cover codes", () => {
    expect(nwsIconToCondition(icon("skc"))).toBe("clear");
    expect(nwsIconToCondition(icon("few"))).toBe("mostly-clear");
    expect(nwsIconToCondition(icon("sct"))).toBe("partly-cloudy");
    expect(nwsIconToCondition(icon("bkn"))).toBe("overcast");
    expect(nwsIconToCondition(icon("ovc"))).toBe("overcast");
  });

  test("maps precipitation codes", () => {
    expect(nwsIconToCondition(icon("rain_showers,20"))).toBe("rain");
    expect(nwsIconToCondition(icon("rain,20/rain,30"))).toBe("rain");
    expect(nwsIconToCondition(icon("hvy_rain"))).toBe("heavy-rain");
    expect(nwsIconToCondition(icon("drizzle"))).toBe("drizzle");
    expect(nwsIconToCondition(icon("fzra"))).toBe("freezing-rain");
    expect(nwsIconToCondition(icon("snow"))).toBe("snow");
    expect(nwsIconToCondition(icon("blizzard"))).toBe("heavy-snow");
    expect(nwsIconToCondition(icon("sleet"))).toBe("sleet");
    expect(nwsIconToCondition(icon("tsra,50"))).toBe("thunderstorm");
    expect(nwsIconToCondition(icon("hail"))).toBe("hail");
    expect(nwsIconToCondition(icon("fog"))).toBe("fog");
  });

  test("precipitation beats co-present sky cover in multi-segment icons", () => {
    expect(nwsIconToCondition(icon("bkn/fog"))).toBe("fog");
    expect(nwsIconToCondition(icon("few/tsra,40"))).toBe("thunderstorm");
    expect(nwsIconToCondition(icon("sct/rain_showers,20"))).toBe("rain");
  });

  test("handles night icons", () => {
    expect(nwsIconToCondition("https://api.weather.gov/icons/land/night/sct?size=medium")).toBe(
      "partly-cloudy",
    );
  });

  test("returns undefined for unknown or malformed icons", () => {
    expect(nwsIconToCondition("https://example.com/nope")).toBeUndefined();
    expect(nwsIconToCondition("")).toBeUndefined();
  });
});

describe("nws shortForecast text fallback", () => {
  test("recognizes common forecast phrasings", () => {
    expect(nwsTextToCondition("Sunny")).toBe("clear");
    expect(nwsTextToCondition("Mostly Sunny")).toBe("mostly-clear");
    expect(nwsTextToCondition("Partly Cloudy")).toBe("partly-cloudy");
    expect(nwsTextToCondition("Mostly Cloudy")).toBe("overcast");
    expect(nwsTextToCondition("Patchy Fog")).toBe("fog");
    expect(nwsTextToCondition("Slight Chance Rain Showers")).toBe("rain");
    expect(nwsTextToCondition("Chance Snow Showers")).toBe("snow");
    expect(nwsTextToCondition("Heavy Rain Likely")).toBe("heavy-rain");
    expect(nwsTextToCondition("Freezing Rain")).toBe("freezing-rain");
    expect(nwsTextToCondition("Wintry Mix")).toBe("sleet");
    expect(nwsTextToCondition("Showers And Thunderstorms")).toBe("thunderstorm");
    expect(nwsTextToCondition("Chance Showers")).toBe("rain");
  });

  test("returns undefined for unrecognized text", () => {
    expect(nwsTextToCondition("Volcanic Eruption")).toBeUndefined();
  });
});

describe("nwsToCondition precedence", () => {
  test("icon wins over text when both are understood", () => {
    expect(nwsToCondition(icon("few"), "Sunny")).toBe("mostly-clear");
  });

  test("falls back to text when the icon is unparseable", () => {
    expect(nwsToCondition("not-an-icon-url", "Partly Cloudy")).toBe("partly-cloudy");
  });

  test("falls back to overcast when nothing is understood", () => {
    expect(nwsToCondition("", "Volcanic Eruption")).toBe("overcast");
  });
});
