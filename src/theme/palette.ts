export type ThemeName = "day" | "night";

export interface Palette {
  fg: string;
  fgDim: string;
  accent: string;
  ok: string;
  warn: string;
  danger: string;
  tempCold: string;
  tempWarm: string;
  border: string;
  surface: string;
}

export const NIGHT_PALETTE: Palette = {
  fg: "#c0caf5",
  fgDim: "#565f89",
  accent: "#7aa2f7",
  ok: "#9ece6a",
  warn: "#e0af68",
  danger: "#f7768e",
  tempCold: "#7dcfff",
  tempWarm: "#ff9e64",
  border: "#3b4261",
  surface: "#16161e",
};

export const DAY_PALETTE: Palette = {
  fg: "#343b58",
  fgDim: "#8990b3",
  accent: "#2e7de9",
  ok: "#387068",
  warn: "#8c6c3e",
  danger: "#c64343",
  tempCold: "#007197",
  tempWarm: "#965027",
  border: "#a8b0d0",
  surface: "#f4f6fb",
};

export function resolvePalette(theme: "day" | "night" | "auto", isDay: boolean): Palette {
  if (theme === "day") return DAY_PALETTE;
  if (theme === "night") return NIGHT_PALETTE;
  return isDay ? DAY_PALETTE : NIGHT_PALETTE;
}
