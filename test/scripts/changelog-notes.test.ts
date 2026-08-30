import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELPER = join(import.meta.dir, "../../scripts/changelog-notes.sh");

let repo: string;
let globalHome: string;

function run(args: string[], cwd: string) {
  const proc = Bun.spawnSync(["bash", ...args], {
    cwd,
    env: { ...globalThis.process.env, HOME: globalHome, XDG_CONFIG_HOME: globalHome },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  };
}

function commit(subject: string) {
  const proc = Bun.spawnSync(["git", "commit", "--allow-empty", "--quiet", "-m", subject], {
    cwd: repo,
    env: { ...globalThis.process.env, HOME: globalHome, XDG_CONFIG_HOME: globalHome },
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
}

beforeAll(async () => {
  globalHome = await mkdtemp(join(tmpdir(), "tuiweather-home-"));
  await writeFile(
    join(globalHome, ".gitconfig"),
    "[user]\n\tname = Test\n\temail = t@example.com\n",
  );
  repo = await mkdtemp(join(tmpdir(), "tuiweather-changelog-"));
  const init = Bun.spawnSync(["git", "init", "--quiet", "."], { cwd: repo });
  expect(init.exitCode).toBe(0);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(globalHome, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("changelog-notes.sh", () => {
  test("classifies feat/fix/other commits into sections from a clean environment", () => {
    commit("feat: sparkline panel");
    commit("fix(hourly): off-by-one bucket label");
    commit("chore: tidy deps");
    commit("docs: explain breakpoints");
    commit("feat!: drop sm breakpoint");
    commit("fix: typo");

    const result = run([HELPER, "v9.9.9", "2026-01-01", "HEAD"], repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("## v9.9.9 (2026-01-01)");
    expect(result.stdout).toContain("### Features");
    expect(result.stdout).toContain("- feat: sparkline panel");
    expect(result.stdout).toContain("- feat!: drop sm breakpoint");
    expect(result.stdout).toContain("### Fixes");
    expect(result.stdout).toContain("- fix(hourly): off-by-one bucket label");
    expect(result.stdout).toContain("- fix: typo");
    expect(result.stdout).toContain("### Other");
    expect(result.stdout).toContain("- chore: tidy deps");
    expect(result.stdout).toContain("- docs: explain breakpoints");
    expect(result.stdout.indexOf("### Features")).toBeLessThan(result.stdout.indexOf("### Fixes"));
    expect(result.stdout.indexOf("### Fixes")).toBeLessThan(result.stdout.indexOf("### Other"));
    expect(result.stderr).toContain("changelog: features=2 fixes=2 other=2");
  });

  test("omits empty sections when the range has no feat/fix commits", () => {
    const sha = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo }).stdout.toString().trim();
    commit("chore: only chores here");
    commit("feature-flagging: not a conventional feat");

    const result = run([HELPER, "v8.0.0", "2026-01-02", `${sha}..HEAD`], repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("### Features");
    expect(result.stdout).not.toContain("### Fixes");
    expect(result.stdout).toContain("### Other");
    expect(result.stderr).toContain("features=0 fixes=0 other=2");
  });

  test("aborts visibly on an invalid git range (set -e is not swallowed)", () => {
    const bad = run([HELPER, "v0.0.0", "2026-01-03", "--not-a-real-ref"], repo);
    expect(bad.exitCode).not.toBe(0);
  });
});
