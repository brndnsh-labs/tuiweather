import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json";

interface PackMetadata {
  filename: string;
  files: Array<{ path: string }>;
  name: string;
}

const ROOT = join(import.meta.dir, "..");

test("the packed artifact contains only the supported product surface and can execute", async () => {
  const work = mkdtempSync(join(tmpdir(), "tuiweather-package-"));
  try {
    execFileSync("bun", ["run", "build"], { cwd: ROOT, stdio: "pipe" });
    const pack = Bun.spawnSync(
      ["npm", "pack", "--json", "--pack-destination", work, "--cache", join(work, "npm-cache")],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    if (pack.exitCode !== 0) {
      throw new Error(`npm pack failed: ${pack.stderr.toString()}`);
    }
    const parsed = JSON.parse(pack.stdout.toString()) as
      | PackMetadata[]
      | Record<string, PackMetadata>;
    const metadata = Array.isArray(parsed) ? parsed[0] : parsed.tuiweather;
    if (metadata === undefined) throw new Error("npm pack did not return package metadata");

    expect(metadata.name).toBe("tuiweather");
    const files = metadata.files.map((entry) => entry.path);
    for (const expected of [
      "LICENSE",
      "README.md",
      "bin/tuiweather.js",
      "dist/index.js",
      "package.json",
    ]) {
      expect(files).toContain(expected);
    }
    for (const excluded of [".github/", "docs/", "scripts/", "src/", "test/", "AGENTS.md"]) {
      expect(files.some((path) => path.startsWith(excluded))).toBe(false);
    }

    const unpacked = join(work, "unpacked");
    mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", join(work, metadata.filename), "-C", unpacked]);
    const packageRoot = join(unpacked, "package");
    const versionOutputPath = join(work, "version-output.txt");
    const versionOutputFd = openSync(versionOutputPath, "w");
    try {
      execFileSync("node", [join(packageRoot, "bin", "tuiweather.js"), "--version"], {
        cwd: packageRoot,
        stdio: ["ignore", versionOutputFd, "pipe"],
      });
    } finally {
      closeSync(versionOutputFd);
    }
    expect(readFileSync(versionOutputPath, "utf8").trim()).toBe(
      `tuiweather ${packageJson.version}`,
    );

    const bin = await Bun.file(join(ROOT, "bin", "tuiweather.js")).text();
    expect(bin.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(bin.includes("--experimental-ffi")).toBe(true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 30_000);
