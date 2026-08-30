import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { ZodError } from "zod";
import { ConfigError } from "./errors";
import { DEFAULT_CONFIG, migrateConfig, type TuiConfig } from "./schema";

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "tuiweather", "config.toml");
  const home = process.env.HOME?.trim() || homedir();
  if (!home) throw new ConfigError("cannot resolve config path: set XDG_CONFIG_HOME or HOME");
  return join(home, ".config", "tuiweather", "config.toml");
}

function isMissingFile(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
}

function shortReason(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const firstLine = raw.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function formatIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const prefix = issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ` : "";
    return `${prefix}${issue.message}`;
  });
}

export async function loadConfig(path?: string): Promise<TuiConfig> {
  const target = path ?? defaultConfigPath();
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (e) {
    if (!isMissingFile(e)) throw e;
    return DEFAULT_CONFIG;
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new ConfigError(`invalid TOML in ${target}: ${shortReason(e)}`);
  }

  let config: TuiConfig;
  try {
    config = migrateConfig(raw);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    const issues = formatIssues(e);
    if (e.issues.some((i) => i.path.length === 0 || i.path[0] === "schema_version")) {
      issues.push("hint: bare keys must appear before any [table] or [[array]] headers in TOML");
    }
    const preview = issues.slice(0, 3).join("\n");
    const more = issues.length > 3 ? `\n... and ${issues.length - 3} more` : "";
    throw new ConfigError(
      `invalid config in ${target}: ${issues.length} issue(s)\n${preview}${more}`,
      issues,
    );
  }
  return config;
}
