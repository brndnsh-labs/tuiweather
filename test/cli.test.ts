import { describe, expect, test } from "bun:test";
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
