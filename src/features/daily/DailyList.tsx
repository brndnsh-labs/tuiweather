import { RangeBar } from "../../components/RangeBar";
import type { DisplayPrefs } from "../../lib/config/schema";
import { conditionGlyph } from "../../lib/providers/openmeteo/wmo";
import { formatDayLabel, formatPct, formatTemp, type Units } from "../../lib/weather/format";
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

interface RowParts {
  head: string;
  lo: number;
  hi: number;
  precip: string | null;
}

function precipChip(day: DailyPoint): string | null {
  const pct = day.precipProbabilityMaxPct;
  if (pct === null || pct < PRECIP_CHIP_MIN_PCT) return null;
  return `☂ ${formatPct(pct)}`;
}

export function anyPrecipChip(days: DailyPoint[], showPrecip: boolean): boolean {
  return showPrecip && days.some((day) => precipChip(day) !== null);
}

function rowParts(day: DailyPoint, showPrecip: boolean): RowParts {
  const label = formatDayLabel(day.dateLocal);
  const glyph = conditionGlyph(day.condition);
  return {
    head: `${label.padEnd(DAY_LABEL_WIDTH)} ${glyph} `,
    lo: day.tempMinC,
    hi: day.tempMaxC,
    precip: showPrecip ? precipChip(day) : null,
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

export function DailyList({ days, prefs, columns, width, showPrecip = true }: DailyListProps) {
  if (days.length === 0 || width < 12) return null;

  const weekMin = Math.min(...days.map((d) => d.tempMinC));
  const weekMax = Math.max(...days.map((d) => d.tempMaxC));
  const showChips = anyPrecipChip(days, showPrecip);

  const colWidth = Math.floor(width / columns);
  const fixedWidth = DAY_LABEL_WIDTH + 3 + 4 + 4 + (showChips ? 7 : 0);
  const barWidth = Math.max(2, colWidth - fixedWidth);

  if (columns === 1) {
    return (
      <box flexDirection="column">
        {days.map((day) => (
          <DailyRow
            key={day.dateLocal}
            parts={rowParts(day, showChips)}
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
                parts={rowParts(day, showChips)}
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
}

export function dailyChips(days: DailyPoint[], units: Units): string {
  return days
    .map(
      (d) =>
        `${formatDayLabel(d.dateLocal)}${conditionGlyph(d.condition)}${formatTemp(d.tempMaxC, units)}`,
    )
    .join(" ");
}
