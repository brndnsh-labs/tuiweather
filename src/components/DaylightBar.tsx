import { formatClock, type TimeFormat } from "../lib/weather/format";
import { usePalette } from "../theme/tokens";

export const DAYLIGHT_MIN_WIDTH = 12;

const TRACK_MIN = 3;
const RISE_GLYPH = "↑";
const SET_GLYPH = "↓";
const TRACK_GLYPH = "─";
const MARKER_DAY = "●";
const MARKER_NIGHT = "○";

export interface DaylightProgressState {
  progress: number;
  isNight: boolean;
}

export function daylightProgress(
  nowMs: number,
  sunriseMs: number,
  sunsetMs: number,
): DaylightProgressState | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs)) {
    return null;
  }
  if (sunsetMs <= sunriseMs) return null;
  const progress = Math.max(0, Math.min(1, (nowMs - sunriseMs) / (sunsetMs - sunriseMs)));
  return { progress, isNight: nowMs < sunriseMs || nowMs > sunsetMs };
}

export type DaylightSegmentKind = "dim" | "accent";

export interface DaylightSegment {
  text: string;
  kind: DaylightSegmentKind;
}

export interface DaylightBarProps {
  sunriseUtc: string | null;
  sunsetUtc: string | null;
  nowUtc: string;
  utcOffsetSeconds: number;
  width: number;
  timeFormat: TimeFormat;
}

export function buildDaylightSegments(props: DaylightBarProps): DaylightSegment[] | null {
  if (props.sunriseUtc === null || props.sunsetUtc === null) return null;
  const state = daylightProgress(
    Date.parse(props.nowUtc),
    Date.parse(props.sunriseUtc),
    Date.parse(props.sunsetUtc),
  );
  if (!state) return null;

  const budget = Math.floor(props.width) - 1;
  if (budget < DAYLIGHT_MIN_WIDTH - 1) return null;

  const riseLabel = formatClock(props.sunriseUtc, props.utcOffsetSeconds, props.timeFormat);
  const setLabel = formatClock(props.sunsetUtc, props.utcOffsetSeconds, props.timeFormat);
  const layouts: [string, string][] = [
    [`${RISE_GLYPH} ${riseLabel}`, `${SET_GLYPH} ${setLabel}`],
    [RISE_GLYPH, SET_GLYPH],
  ];

  for (const [headText, tailText] of layouts) {
    const trackLen = budget - headText.length - tailText.length - 2;
    if (trackLen < TRACK_MIN) continue;
    const markerIdx = Math.max(
      0,
      Math.min(trackLen - 1, Math.round(state.progress * (trackLen - 1))),
    );
    const dim = (text: string): DaylightSegment => ({ text, kind: "dim" });
    return [
      dim(`${headText} ${TRACK_GLYPH.repeat(markerIdx)}`),
      { text: state.isNight ? MARKER_NIGHT : MARKER_DAY, kind: state.isNight ? "dim" : "accent" },
      dim(`${TRACK_GLYPH.repeat(trackLen - 1 - markerIdx)} ${tailText}`),
    ];
  }
  return null;
}

export function buildDaylightRow(props: DaylightBarProps): string | null {
  const segments = buildDaylightSegments(props);
  return segments ? segments.map((segment) => segment.text).join("") : null;
}

export function DaylightBar(props: DaylightBarProps) {
  const palette = usePalette();
  const segments = buildDaylightSegments(props);
  if (!segments) return null;
  let offset = 0;
  return (
    <text>
      {segments.map((segment) => {
        const key = offset;
        offset += segment.text.length;
        return (
          <span key={key} fg={segment.kind === "accent" ? palette.accent : palette.fgDim}>
            {segment.text}
          </span>
        );
      })}
    </text>
  );
}
