import { type InkName, isDarkBackground } from "./palette";

export interface TerminalAppearance {
  ink: InkName;
  background: string | null;
}

export interface PaletteQuery {
  getPalette(options?: { timeout?: number }): Promise<{ defaultBackground?: string | null }>;
}

export const FALLBACK_APPEARANCE: TerminalAppearance = { ink: "dark", background: null };

export function appearancesEqual(a: TerminalAppearance, b: TerminalAppearance): boolean {
  return a.ink === b.ink && a.background === b.background;
}

export async function detectTerminalAppearance(
  query: PaletteQuery,
  timeoutMs = 300,
): Promise<TerminalAppearance> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const colors = await Promise.race([
      query.getPalette({ timeout: timeoutMs }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("palette query timed out")), timeoutMs);
      }),
    ]);
    const background = colors?.defaultBackground ?? null;
    return { ink: isDarkBackground(background) ? "dark" : "light", background };
  } catch {
    return FALLBACK_APPEARANCE;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
