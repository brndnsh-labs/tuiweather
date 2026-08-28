import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELP_TEXT, parseArgs, USAGE, UsageError, VERSION } from "../src/cli";

describe("parseArgs", () => {
  test("defaults to the interactive app", () => {
    expect(parseArgs([])).toEqual({
      command: "run",
      oneLine: false,
      location: null,
      latLon: null,
      json: false,
      interval: null,
    });
  });

  test("parses one-line mode and a configured location", () => {
    expect(parseArgs(["--one-line", "--location", "portland"])).toEqual({
      command: "run",
      oneLine: true,
      location: "portland",
      latLon: null,
      json: false,
      interval: null,
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

  test("parses coordinates with the json flag", () => {
    expect(parseArgs(["--one-line", "--json", "--lat", "45.52", "--lon", "-122.67"])).toEqual({
      command: "run",
      oneLine: true,
      location: null,
      latLon: { latitude: 45.52, longitude: -122.67 },
      json: true,
      interval: null,
    });
  });

  test("coordinates require both halves", () => {
    expect(() => parseArgs(["--lat", "45.5"])).toThrow("--lat and --lon must be given together");
    expect(() => parseArgs(["--lon", "-122.7"])).toThrow("--lat and --lon must be given together");
  });

  test("coordinates require numeric values in range", () => {
    expect(() => parseArgs(["--lat"])).toThrow(UsageError);
    expect(() => parseArgs(["--lon"])).toThrow(UsageError);
    expect(() => parseArgs(["--lat", "abc", "--lon", "0"])).toThrow("--lat requires a number");
    expect(() => parseArgs(["--lat", "90.5", "--lon", "0"])).toThrow(
      "--lat must be between -90 and 90",
    );
    expect(() => parseArgs(["--lat", "0", "--lon", "-180.5"])).toThrow(
      "--lon must be between -180 and 180",
    );
  });

  test("coordinates conflict with --location", () => {
    expect(() => parseArgs(["--location", "portland", "--lat", "45.5", "--lon", "-122.7"])).toThrow(
      "--lat/--lon cannot be combined with --location",
    );
    expect(() => parseArgs(["--lat", "45.5", "--location", "portland"])).toThrow(
      "--lat/--lon cannot be combined with --location",
    );
  });

  test("help text documents the scripting flags", () => {
    expect(HELP_TEXT).toContain("--lat <num>");
    expect(HELP_TEXT).toContain("--lon <num>");
    expect(HELP_TEXT).toContain("--json");
  });

  test("parses watch command", () => {
    expect(parseArgs(["watch"]).command).toBe("watch");
    expect(parseArgs(["watch"]).interval).toBeNull();
  });

  test("parses watch interval", () => {
    expect(parseArgs(["watch", "--interval", "5"])).toEqual(
      expect.objectContaining({ command: "watch", interval: 5 }),
    );
  });

  test("interval requires watch", () => {
    expect(() => parseArgs(["--interval", "5"])).toThrow("--interval can only be used with watch");
  });

  test("interval must be integer 1-120", () => {
    expect(() => parseArgs(["watch", "--interval", "0"])).toThrow(
      "--interval must be an integer between 1 and 120",
    );
    expect(() => parseArgs(["watch", "--interval", "121"])).toThrow(
      "--interval must be an integer between 1 and 120",
    );
    expect(() => parseArgs(["watch", "--interval", "2.5"])).toThrow(
      "--interval must be an integer between 1 and 120",
    );
  });

  test("watch cannot be combined with json or one-line", () => {
    expect(() => parseArgs(["watch", "--json"])).toThrow("--json cannot be combined with watch");
    expect(() => parseArgs(["watch", "--one-line"])).toThrow(
      "--one-line cannot be combined with watch",
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

test.each([
  [["--one-line", "--lat", "45.52"], "--lat and --lon must be given together"],
  [
    ["--one-line", "--lat", "45.52", "--lon", "-122.67", "--location", "portland"],
    "--lat/--lon cannot be combined with --location",
  ],
  [["--one-line", "--lat", "91", "--lon", "0"], "--lat must be between -90 and 90"],
])("usage errors print the message plus usage line: %j", async (argv, message) => {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", "src/index.tsx", ...argv],
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

  expect(exitCode).toBe(2);
  expect(stderr).toContain(message);
  expect(stderr).toContain("usage: tuiweather");
});
