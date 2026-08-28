import type { DisplayPrefs } from "../lib/config/schema";
import { deriveNowcast, describeNowcast, type Nowcast } from "../lib/weather/derive";
import type { NormalizedForecast } from "../lib/weather/types";
import { buildOneLine } from "./oneline";

export function shouldBell(prev: Nowcast, next: Nowcast): boolean {
  return prev.kind === "dry" && next.kind !== "dry";
}

export interface WatchOptions {
  fetch: () => Promise<{ forecast: NormalizedForecast; stale: boolean }>;
  prefs: DisplayPrefs;
  intervalMs: number;
  write: (text: string) => void;
  label?: string | null;
  maxPolls?: number;
  nowUtc?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export async function runWatch(opts: WatchOptions): Promise<number> {
  const nowUtcFn = opts.nowUtc ?? (() => new Date().toISOString());
  const sleepFn = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let prev: Nowcast | null = null;
  let polls = 0;

  while (opts.maxPolls === undefined || polls < opts.maxPolls) {
    const { forecast } = await opts.fetch();
    const nowUtc = nowUtcFn();
    const rawLine = buildOneLine(forecast, opts.prefs, nowUtc);
    const line = opts.label != null && opts.label !== "" ? `${opts.label}: ${rawLine}` : rawLine;
    opts.write(`${line}\n`);
    const next = deriveNowcast(forecast, nowUtc);
    if (prev !== null && shouldBell(prev, next)) {
      opts.write(`${describeNowcast(next)}\n`);
      opts.write("\x07");
    }
    prev = next;
    polls += 1;
    if (opts.maxPolls !== undefined && polls >= opts.maxPolls) break;
    await sleepFn(opts.intervalMs);
  }

  return polls;
}
