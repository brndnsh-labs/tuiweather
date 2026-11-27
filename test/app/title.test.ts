import { describe, expect, test } from "bun:test";
import { terminalTitle } from "../../src/app/title";

describe("terminalTitle", () => {
  test("leads with temperature in the user's units", () => {
    expect(terminalTitle("Boston", 5, "metric")).toBe("5° Boston · tuiweather");
    expect(terminalTitle("Boston", 5, "imperial")).toBe("41° Boston · tuiweather");
  });

  test("drops the temperature when the observation has none", () => {
    expect(terminalTitle("Boston", null, "metric")).toBe("Boston · tuiweather");
  });

  test("falls back to the app name without a location or forecast", () => {
    expect(terminalTitle(undefined, 5, "metric")).toBe("tuiweather");
    expect(terminalTitle("Boston", undefined, "metric")).toBe("tuiweather");
  });

  test("strips control characters so a label cannot inject escape sequences", () => {
    expect(terminalTitle("Bos\u001b]0;pwned\u0007ton", 5, "metric")).toBe(
      "5° Bos]0;pwnedton · tuiweather",
    );
  });
});
