export type ThemeName = "day" | "night";
export type InkName = "light" | "dark";

export interface Ink {
  fg: string;
  fgDim: string;
  border: string;
  surface: string;
  panel: string;
  selection: string;
}

export interface Accents {
  accent: string;
  ok: string;
  warn: string;
  danger: string;
  tempCold: string;
  tempWarm: string;
  rain: string;
}

export interface Palette extends Ink, Accents {}

export const DARK_INK: Ink = {
  fg: "#e3edf5",
  fgDim: "#92a8ba",
  border: "#314b60",
  surface: "#0b1520",
  panel: "#112231",
  selection: "#203d50",
};

export const LIGHT_INK: Ink = {
  fg: "#173247",
  fgDim: "#506a7b",
  border: "#94b0bf",
  surface: "#f0f5f7",
  panel: "#e3edf1",
  selection: "#cbdfe8",
};

export const DAY_ACCENTS: Accents = {
  accent: "#007e97",
  ok: "#397559",
  warn: "#916013",
  danger: "#ba354f",
  tempCold: "#007bba",
  tempWarm: "#b06424",
  rain: "#087f90",
};

export const NIGHT_ACCENTS: Accents = {
  accent: "#65dce8",
  ok: "#a3deb0",
  warn: "#f2c078",
  danger: "#ff879e",
  tempCold: "#80caff",
  tempWarm: "#ffb66f",
  rain: "#65c9e8",
};

export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  const body = m?.[1];
  if (!body) return null;
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const lin = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin;
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 1;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isDarkBackground(hex: string | null | undefined): boolean {
  if (!hex) return true;
  const lum = relativeLuminance(hex);
  if (lum === null) return true;
  return lum < 0.5;
}

export function ensureContrast(color: string, bg: string, minRatio: number): string {
  if (contrastRatio(color, bg) >= minRatio) return color;
  const toward = isDarkBackground(bg) ? "#ffffff" : "#000000";
  const rgb = parseHexColor(color);
  const tgt = parseHexColor(toward);
  if (!rgb || !tgt) return color;
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = rgb
      .map((c, i) => Math.round(c + ((tgt[i] ?? c) - c) * t))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("");
    const candidate = `#${mixed}`;
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return toward;
}

export const FOREGROUND_CONTRAST_FLOOR = 4.5;

export function buildPalette(
  theme: ThemeName | "auto",
  isDay: boolean,
  ink: InkName,
  terminalBackground: string | null,
): Palette {
  const base: Palette = {
    ...(ink === "dark" ? DARK_INK : LIGHT_INK),
    ...(theme === "day"
      ? DAY_ACCENTS
      : theme === "night"
        ? NIGHT_ACCENTS
        : isDay
          ? DAY_ACCENTS
          : NIGHT_ACCENTS),
  };
  const bg = terminalBackground ?? base.surface;
  const onSurface = (color: string) =>
    ensureContrast(color, base.surface, FOREGROUND_CONTRAST_FLOOR);
  return {
    ...base,
    fg: ensureContrast(base.fg, bg, FOREGROUND_CONTRAST_FLOOR),
    fgDim: ensureContrast(base.fgDim, bg, FOREGROUND_CONTRAST_FLOOR),
    warn: ensureContrast(base.warn, bg, FOREGROUND_CONTRAST_FLOOR),
    danger: ensureContrast(base.danger, bg, FOREGROUND_CONTRAST_FLOOR),
    accent: onSurface(base.accent),
    ok: onSurface(base.ok),
    tempCold: onSurface(base.tempCold),
    tempWarm: onSurface(base.tempWarm),
    rain: onSurface(base.rain),
  };
}

export function panelPalette(palette: Palette, surface = palette.panel): Palette {
  const readable = (color: string) => ensureContrast(color, surface, FOREGROUND_CONTRAST_FLOOR);
  return {
    ...palette,
    surface,
    fg: readable(palette.fg),
    fgDim: readable(palette.fgDim),
    accent: readable(palette.accent),
    ok: readable(palette.ok),
    warn: readable(palette.warn),
    danger: readable(palette.danger),
    tempCold: readable(palette.tempCold),
    tempWarm: readable(palette.tempWarm),
    rain: readable(palette.rain),
  };
}

export const DEFAULT_APPEARANCE: InkName = "dark";
