import type { Condition } from "../lib/weather/types";
import { usePalette } from "../theme/tokens";

const SUN = ["      │      ", "   ╲  │  ╱   ", " ──  ( )  ── ", "   ╱  │  ╲   ", "      │      "];
const MOON = ["     .──.    ", "    / .´     ", "    │ (   ·  ", "    \\ `─.    ", "     `──´    "];
const CLOUD = ["    .───.    ", " .─(     ).  ", "(__________) "];

export function weatherArt(condition: Condition, isDay: boolean): string[] {
  switch (condition) {
    case "clear":
      return isDay ? SUN : MOON;
    case "mostly-clear":
    case "partly-cloudy":
      return [
        isDay ? "  \\ │ /     " : "    .─´   ·  ",
        "   .─.───.   ",
        ...CLOUD.slice(1),
        "             ",
      ];
    case "overcast":
      return ["             ", ...CLOUD, "             "];
    case "fog":
      return ["             ", " ─── ──────  ", "   ───── ──  ", " ───── ────  ", "             "];
    case "snow":
    case "heavy-snow":
      return [...CLOUD, "  *  *  *    ", "    *  *  *  "];
    case "thunderstorm":
      return [...CLOUD, "     /_  /   ", "    /   /    "];
    case "hail":
    case "sleet":
    case "freezing-rain":
      return [...CLOUD, "  /  o  /    ", "    o  /  o  "];
    case "drizzle":
      return [...CLOUD, "    ·   ·    ", "  ·   ·      "];
    case "rain":
    case "heavy-rain":
      return [...CLOUD, "  /  /  /    ", " /  /  /     "];
  }
}

export function WeatherArt({ condition, isDay }: { condition: Condition; isDay: boolean }) {
  const palette = usePalette();
  const color =
    condition === "clear" || condition === "mostly-clear"
      ? isDay
        ? palette.warn
        : palette.accent
      : condition === "thunderstorm"
        ? palette.warn
        : palette.rain;
  return (
    <text width={14} height={5} flexShrink={0} fg={color}>
      {weatherArt(condition, isDay).join("\n")}
    </text>
  );
}
