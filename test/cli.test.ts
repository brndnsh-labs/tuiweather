import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELP_TEXT, parseArgs, USAGE, UsageError, VERSION } from "../src/cli";

describe("parseArgs", () => {
  test("defaults to the interactive app", () => {
    expect(parseArgs([])).toEqual({ command: "run", oneLine: false, location: null });
  });

  test("parses one-line mode and a configured location", () => {
    expect(parseArgs(["--one-line", "--location", "portland"])).toEqual({
      command: "run",
      oneLine: true,
      location: "portland",
    });
  });

  test("recognizes help and version aliases", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["-v"]).command).toBe("version");
  });

  test("rejects missing values, unknown arguments, and mixed informational flags", () => {
    expect(() => parseArgs(["--location"])).toThrow(UsageError);
    expect(() => parseArgs(["--wat"])).toThrow('unknown argument "--wat"');
    expect(() => parseArgs(["--help", "--one-line"])).toThrow(
      "--help cannot be combined with other arguments",
    );
    expect(() => parseArgs(["--version", "--location", "portland"])).toThrow(
      "--version cannot be combined with other arguments",
    );
  });
});

test("CLI identity text stays tied to package metadata", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  expect(USAGE).toContain("tuiweather");
  expect(HELP_TEXT).toContain("--version");
});

test("one-line mode directs an unconfigured user to interactive setup", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "tuiweather-cli-test-"));
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "src/index.tsx", "--one-line"],
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, XDG_CONFIG_HOME: configHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("no locations configured");
    expect(stderr).toContain("run tuiweather to set one up");
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});
