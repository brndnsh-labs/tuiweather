import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultConfigPath } from "../../src/lib/config/load";

test("defaultConfigPath falls back to os.homedir when XDG_CONFIG_HOME and HOME are unset", () => {
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousHome = process.env.HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.HOME;
  try {
    const path = defaultConfigPath();
    expect(path).toBe(join(homedir(), ".config", "tuiweather", "config.toml"));
  } finally {
    if (previousXdg !== undefined) process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousHome !== undefined) process.env.HOME = previousHome;
  }
});
