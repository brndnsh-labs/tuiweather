export type Tier = "xs" | "sm" | "md" | "lg";

export const MIN_WIDTH = 32;

export const TIER_THRESHOLDS = {
  lg: 96,
  md: 68,
  sm: 48,
} as const;

export function tierFor(width: number): Tier {
  if (width >= TIER_THRESHOLDS.lg) return "lg";
  if (width >= TIER_THRESHOLDS.md) return "md";
  if (width >= TIER_THRESHOLDS.sm) return "sm";
  return "xs";
}
