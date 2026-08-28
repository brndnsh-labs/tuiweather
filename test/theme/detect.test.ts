import { describe, expect, test } from "bun:test";
import {
  detectTerminalAppearance,
  FALLBACK_APPEARANCE,
  type PaletteQuery,
} from "../../src/theme/detect";

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
