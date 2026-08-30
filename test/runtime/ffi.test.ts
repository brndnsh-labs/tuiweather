import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  FFI_MIN_NODE,
  formatFfiUnavailableMessage,
  isFfiAvailable,
  probeFfiAvailable,
} from "../../src/lib/runtime/ffi";

describe("isFfiAvailable", () => {
  test("old node without flags is not available", () => {
    expect(isFfiAvailable({ nodeVersion: "24.3.0", hasFlags: false })).toBe(false);
    expect(isFfiAvailable({ nodeVersion: "24.11.0", hasFlags: false })).toBe(false);
    expect(isFfiAvailable({ nodeVersion: "26.3.9", hasFlags: false })).toBe(false);
    expect(isFfiAvailable({ nodeVersion: "20.19.0", hasFlags: false })).toBe(false);
  });

  test("new node meets minimum version", () => {
    expect(isFfiAvailable({ nodeVersion: "26.4.0", hasFlags: false })).toBe(true);
    expect(isFfiAvailable({ nodeVersion: "26.4.1", hasFlags: false })).toBe(true);
    expect(isFfiAvailable({ nodeVersion: "26.8.1", hasFlags: false })).toBe(true);
    expect(isFfiAvailable({ nodeVersion: "27.0.0", hasFlags: false })).toBe(true);
    expect(isFfiAvailable({ nodeVersion: "v26.4.0", hasFlags: false })).toBe(true);
  });

  test("bun is always available regardless of node version or flags", () => {
    expect(isFfiAvailable({ bunVersion: "1.3.13", nodeVersion: "24.3.0", hasFlags: false })).toBe(
      true,
    );
    expect(isFfiAvailable({ bunVersion: "1.2.0", nodeVersion: "20.0.0", hasFlags: false })).toBe(
      true,
    );
    expect(isFfiAvailable({ bunVersion: "1.3.13", nodeVersion: "26.4.0", hasFlags: true })).toBe(
      true,
    );
  });

  test("flagged runtime is available even on older version", () => {
    expect(isFfiAvailable({ nodeVersion: "24.3.0", hasFlags: true })).toBe(true);
    expect(isFfiAvailable({ nodeVersion: "26.4.0", hasFlags: true })).toBe(true);
  });

  test("FFI_MIN_NODE is [26,4,0]", () => {
    expect([...FFI_MIN_NODE]).toEqual([26, 4, 0]);
  });
});

describe("formatFfiUnavailableMessage", () => {
  test("contains requirement, detected version and CLI hint", () => {
    const msg = formatFfiUnavailableMessage("24.3.0");
    expect(msg).toContain("interactive TUI requires Bun or Node >= 26.4");
    expect(msg).toContain("detected node 24.3.0");
    expect(msg).toContain("--version");
    expect(msg).toContain("--one-line");
  });

  test("embeds the provided node version verbatim", () => {
    expect(formatFfiUnavailableMessage("22.11.0")).toContain("22.11.0");
    expect(formatFfiUnavailableMessage("26.3.9")).toContain("26.3.9");
  });
});

describe("probeFfiAvailable", () => {
  test("returns true under Bun without attempting node:ffi import", async () => {
    expect(await probeFfiAvailable()).toBe(true);
  });
});

describe("launcher parity", () => {
  test("bin/tuiweather.js stays in sync with FFI_MIN_NODE and nodeAtLeast", async () => {
    const launcher = await Bun.file(join(import.meta.dir, "../../bin/tuiweather.js")).text();
    expect(launcher.replace(/\s/g, "")).toContain(JSON.stringify(FFI_MIN_NODE));
    expect(launcher).toContain("nodeAtLeast");
  });
});
