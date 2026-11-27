import { formatTemp, type Units } from "../lib/weather/format";

export const APP_TITLE = "tuiweather";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them keeps labels out of the OSC sequence
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function terminalTitle(
  locationLabel: string | undefined,
  temperatureC: number | null | undefined,
  units: Units,
): string {
  if (locationLabel === undefined || temperatureC === undefined) return APP_TITLE;
  const label = locationLabel.replace(CONTROL_CHARS, "");
  const lead = temperatureC === null ? label : `${formatTemp(temperatureC, units)} ${label}`;
  return `${lead} · ${APP_TITLE}`;
}
