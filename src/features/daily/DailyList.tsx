import { memo } from "react";
import { RangeBar } from "../../components/RangeBar";
import type { DisplayPrefs } from "../../lib/config/schema";
import { CONDITION_ICON_CELLS, conditionIcon } from "../../lib/weather/condition-display";
import {
  formatDayLabel,
  formatPct,
  formatPrecip,
  formatTemp,
  type Units,
} from "../../lib/weather/format";
import type { DailyPoint } from "../../lib/weather/types";
import { usePalette } from "../../theme/tokens";

interface DailyListProps {
  days: DailyPoint[];
  prefs: DisplayPrefs;
  columns: 1 | 2;
  width: number;
  showPrecip?: boolean;
}

const DAY_LABEL_WIDTH = 3;
const PRECIP_CHIP_MIN_PCT = 20;
const TRACE_MM = 0.05;
const CHIP_SEPARATOR = " · ";
const BAR_MIN_WIDTH = 2;

const CHIP_LEADING_SPACE = 1;
const CHIP_PROB_MAX = "☂ 100%".length;
/** formatPrecip worst cases: "1234.5 mm" (metric ≥1000mm), "10.00 in" (imperial ≥254mm). */
const CHIP_AMOUNT_MAX = Math.max("12.5 mm".length, "0.31 in".length, "1234.5 mm".length);

export const CHIP_PROB_ONLY_RESERVE = CHIP_LEADING_SPACE + CHIP_PROB_MAX;
export const CHIP_FULL_RESERVE =
  CHIP_LEADING_SPACE + CHIP_PROB_MAX + CHIP_SEPARATOR.length + CHIP_AMOUNT_MAX;

const ICON_SEGMENT_CELLS = 1 + CONDITION_ICON_CELLS + 1;
const BASE_FIXED_WIDTH = DAY_LABEL_WIDTH + ICON_SEGMENT_CELLS + 4 + 4;

export type PrecipChipTier = "none" | "prob" | "full";

const TIER_LADDER: Record<PrecipChipTier, readonly PrecipChipTier[]> = {
  full: ["full", "prob", "none"],
  prob: ["prob", "none"],
  none: ["none"],
};

const TIER_RESERVE: Record<PrecipChipTier, number> = {
  full: CHIP_FULL_RESERVE,
  prob: CHIP_PROB_ONLY_RESERVE,
  none: 0,
};

function passesProbGate(day: DailyPoint): boolean {
  const pct = day.precipProbabilityMaxPct;
  return pct !== null && pct >= PRECIP_CHIP_MIN_PCT;
}

export function precipChip(day: DailyPoint, units: Units, withAmount = true): string | null {
  if (!passesProbGate(day)) return null;
  const prob = `☂ ${formatPct(day.precipProbabilityMaxPct)}`;
  if (!withAmount || day.precipSumMm < TRACE_MM) return prob;
  return `${prob}${CHIP_SEPARATOR}${formatPrecip(day.precipSumMm, units)}`;
}

export function anyPrecipChip(days: DailyPoint[], showPrecip: boolean): boolean {
  return showPrecip && days.some(passesProbGate);
}

function chipCeiling(days: DailyPoint[], showPrecip: boolean): PrecipChipTier {
  if (!anyPrecipChip(days, showPrecip)) return "none";
  return days.some((d) => passesProbGate(d) && d.precipSumMm >= TRACE_MM) ? "full" : "prob";
}

export interface DailyListMetrics {
  colWidth: number;
  barWidth: number;
  chipTier: PrecipChipTier;
}

export function dailyMetrics(
  days: DailyPoint[],
  opts: { width: number; columns: 1 | 2; showPrecip: boolean },
): DailyListMetrics {
  const colWidth = Math.floor(opts.width / opts.columns);
  const ceiling = chipCeiling(days, opts.showPrecip);
  for (const tier of TIER_LADDER[ceiling]) {
    const barWidth = colWidth - BASE_FIXED_WIDTH - TIER_RESERVE[tier];
    if (barWidth >= BAR_MIN_WIDTH) return { colWidth, barWidth, chipTier: tier };
  }
  return { colWidth, barWidth: BAR_MIN_WIDTH, chipTier: "none" };
}

interface RowParts {
  head: string;
  lo: number;
  hi: number;
  precip: string | null;
}

function rowParts(day: DailyPoint, units: Units, chipTier: PrecipChipTier): RowParts {
  const label = formatDayLabel(day.dateLocal);
  const glyph = conditionIcon(day.condition);
  return {
    head: `${label.padEnd(DAY_LABEL_WIDTH)} ${glyph} `,
    lo: day.tempMinC,
    hi: day.tempMaxC,
    precip: chipTier === "none" ? null : precipChip(day, units, chipTier === "full"),
  };
}

function DailyRow({
  parts,
  temp,
  barWidth,
  weekMin,
  weekMax,
}: {
  parts: RowParts;
  temp: DisplayPrefs["temp"];
  barWidth: number;
  weekMin: number;
  weekMax: number;
}) {
  const palette = usePalette();
  return (
    <box flexDirection="row">
      <text fg={palette.fgDim}>{parts.head}</text>
      <text fg={palette.fg}>{formatTemp(parts.lo, temp)}</text>
      <RangeBar
        lo={parts.lo}
        hi={parts.hi}
        weekMin={weekMin}
        weekMax={weekMax}
        width={barWidth}
        palette={palette}
      />
      <text fg={palette.fg}>{formatTemp(parts.hi, temp)}</text>
      {parts.precip !== null ? <text fg={palette.accent}>{` ${parts.precip}`}</text> : null}
    </box>
  );
}

export const DailyList = memo(function DailyList({
  days,
  prefs,
  columns,
  width,
  showPrecip = true,
}: DailyListProps) {
  if (days.length === 0 || width < 12) return null;

  const weekMin = Math.min(...days.map((d) => d.tempMinC));
  const weekMax = Math.max(...days.map((d) => d.tempMaxC));
  const { colWidth, barWidth, chipTier } = dailyMetrics(days, { width, columns, showPrecip });

  if (columns === 1) {
    return (
      <box flexDirection="column">
        {days.map((day) => (
          <DailyRow
            key={day.dateLocal}
            parts={rowParts(day, prefs.precip, chipTier)}
            temp={prefs.temp}
            barWidth={barWidth}
            weekMin={weekMin}
            weekMax={weekMax}
          />
        ))}
      </box>
    );
  }

  const rows: DailyPoint[][] = [];
  for (let i = 0; i < days.length; i += 2) {
    rows.push(days.slice(i, i + 2));
  }
  return (
    <box flexDirection="column">
      {rows.map((pair, idx) => (
        <box key={pair[0]?.dateLocal ?? idx} flexDirection="row">
          {pair.map((day) => (
            <box key={day.dateLocal} flexDirection="row" width={colWidth} flexShrink={0}>
              <DailyRow
                parts={rowParts(day, prefs.precip, chipTier)}
                temp={prefs.temp}
                barWidth={barWidth}
                weekMin={weekMin}
                weekMax={weekMax}
              />
            </box>
          ))}
        </box>
      ))}
    </box>
  );
});

export function dailyChips(days: DailyPoint[], units: Units): string {
  return days
    .map(
      (d) =>
        `${formatDayLabel(d.dateLocal)}${conditionIcon(d.condition)}${formatTemp(d.tempMaxC, units)}`,
    )
    .join(" ");
}
