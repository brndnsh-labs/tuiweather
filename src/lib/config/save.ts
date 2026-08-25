import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { stringify } from "smol-toml";
import { defaultConfigPath } from "./load";
import { type TuiConfig, tuiConfigSchema } from "./schema";

function serialize(config: TuiConfig): string {
  const doc: Record<string, unknown> = {
    schema_version: config.schema_version,
    time_format: config.time_format,
    refresh_minutes: config.refresh_minutes,
    theme: config.theme,
    daily_days: config.daily_days,
    hourly_hours: config.hourly_hours,
  };
  // A TOML document cannot hold both `units = "..."` and a [units] table, so
  // emit the scalar shorthand only when the matrix is uniform and matches it.
  const prefs = config.unit_prefs;
  const uniform =
    prefs.temp === prefs.wind && prefs.wind === prefs.precip && prefs.precip === prefs.pressure;
  doc.units = uniform && prefs.temp === config.units ? config.units : { ...prefs };
  if (config.default_location !== undefined) doc.default_location = config.default_location;
  doc.panels = { ...config.panels };
  doc.locations = config.locations.map((loc) => ({ ...loc }));
  const text = stringify(doc);
  return text.endsWith("\n") ? text : `${text}\n`;
}

export async function saveConfig(config: TuiConfig, path?: string): Promise<void> {
  tuiConfigSchema.parse(config);
  const target = path ?? defaultConfigPath();
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${basename(target)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  let created = false;
  try {
    const handle = await open(tmp, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(serialize(config), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tmp, 0o600);
    await rename(tmp, target);
  } catch (e) {
    if (created) await unlink(tmp).catch(() => {});
    throw e;
  }
}
