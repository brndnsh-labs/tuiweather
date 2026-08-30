import { describe, expect, test } from "bun:test";
import {
  detectTerminalAppearance,
  FALLBACK_APPEARANCE,
  type PaletteQuery,
  resolveTerminalAppearance,
} from "../../src/theme/detect";
import { buildPalette, DARK_INK, LIGHT_INK } from "../../src/theme/palette";

type Detected = { defaultBackground?: string | null };

function fakeQuery(colors: Detected | null): PaletteQuery {
  return { getPalette: async () => colors ?? {} };
}

describe("detectTerminalAppearance", () => {
  test("light background selects light ink and is carried through", async () => {
    const result = await detectTerminalAppearance(fakeQuery({ defaultBackground: "#f4f6fb" }));
    expect(result.ink).toBe("light");
    expect(result.background).toBe("#f4f6fb");
  });

  test("dark background selects dark ink", async () => {
    const result = await detectTerminalAppearance(fakeQuery({ defaultBackground: "#1e1e2e" }));
    expect(result.ink).toBe("dark");
  });

  test("rejected query falls back to dark without throwing", async () => {
    const query: PaletteQuery = {
      getPalette: async () => {
        throw new Error("suspended");
      },
    };
    expect(await detectTerminalAppearance(query)).toEqual(FALLBACK_APPEARANCE);
  });

  test("silent terminal times out to the dark fallback", async () => {
    const query: PaletteQuery = { getPalette: () => new Promise(() => {}) };
    const started = Date.now();
    const result = await detectTerminalAppearance(query, 50);
    expect(result).toEqual(FALLBACK_APPEARANCE);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("missing or malformed background values degrade to dark", async () => {
    expect((await detectTerminalAppearance(fakeQuery({}))).ink).toBe("dark");
    expect((await detectTerminalAppearance(fakeQuery({ defaultBackground: "nonsense" }))).ink).toBe(
      "dark",
    );
    expect((await detectTerminalAppearance(fakeQuery(null))).ink).toBe("dark");
  });
});

describe("resolveTerminalAppearance", () => {
  test("explicit light skips detection and yields light ink with null background", async () => {
    let called = false;
    const query: PaletteQuery = {
      getPalette: async () => {
        called = true;
        return { defaultBackground: "#000000" };
      },
    };
    const result = await resolveTerminalAppearance("light", query);
    expect(result).toEqual({ ink: "light", background: null });
    expect(called).toBe(false);
    const palette = buildPalette("auto", true, result.ink, result.background);
    expect(palette.fg).toBe(LIGHT_INK.fg);
    expect(palette.surface).toBe(LIGHT_INK.surface);
  });

  test("explicit dark skips detection and yields dark ink tokens", async () => {
    let called = false;
    const query: PaletteQuery = {
      getPalette: async () => {
        called = true;
        return { defaultBackground: "#ffffff" };
      },
    };
    const result = await resolveTerminalAppearance("dark", query);
    expect(result).toEqual({ ink: "dark", background: null });
    expect(called).toBe(false);
    const palette = buildPalette("auto", true, result.ink, result.background);
    expect(palette.fg).toBe(DARK_INK.fg);
    expect(palette.surface).toBe(DARK_INK.surface);
  });

  test("auto delegates to detectTerminalAppearance", async () => {
    const light = await resolveTerminalAppearance(
      "auto",
      fakeQuery({ defaultBackground: "#f4f6fb" }),
    );
    expect(light.ink).toBe("light");
    expect(light.background).toBe("#f4f6fb");

    const fallback = await resolveTerminalAppearance("auto", {
      getPalette: async () => {
        throw new Error("fail");
      },
    });
    expect(fallback).toEqual(FALLBACK_APPEARANCE);

    const timed: PaletteQuery = { getPalette: () => new Promise(() => {}) };
    const result = await resolveTerminalAppearance("auto", timed, 20);
    expect(result).toEqual(FALLBACK_APPEARANCE);
  });

  test("explicit ink never calls getPalette even when it would hang", async () => {
    const hanging: PaletteQuery = { getPalette: () => new Promise(() => {}) };
    const started = Date.now();
    const result = await resolveTerminalAppearance("dark", hanging, 20);
    expect(result).toEqual({ ink: "dark", background: null });
    expect(Date.now() - started).toBeLessThan(50);
  });
});
