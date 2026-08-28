import { type InkName, isDarkBackground } from "./palette";

export interface TerminalAppearance {
  ink: InkName;
  background: string | null;
}

export interface PaletteQuery {
  getPalette(options?: { timeout?: number }): Promise<{ defaultBackground?: string | null }>;
}

export const FALLBACK_APPEARANCE: TerminalAppearance = { ink: "dark", background: null };

export async function detectTerminalAppearance(
  query: PaletteQuery,
  timeoutMs = 300,
): Promise<TerminalAppearance> {
  try {
    const colors = await Promise.race([
      query.getPalette({ timeout: timeoutMs }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("palette query timed out")), timeoutMs);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      }),
    ]);
    const background = colors?.defaultBackground ?? null;
    return { ink: isDarkBackground(background) ? "dark" : "light", background };
  } catch {
    return FALLBACK_APPEARANCE;
  }
}
