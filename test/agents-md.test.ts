import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

describe("AGENTS.md architecture map", () => {
  test("lists every src/features/ subdirectory", () => {
    const featureDirs = readdirSync(join(ROOT, "src/features"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const agentsMd = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const featuresLine = agentsMd.split("\n").find((line) => line.trim().startsWith("features/"));
    expect(featuresLine).toBeDefined();
    for (const dir of featureDirs) {
      expect(featuresLine).toContain(`${dir}/`);
    }
  });
});
