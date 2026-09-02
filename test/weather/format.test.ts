import { describe, expect, test } from "bun:test";
import {
  convertTempC,
  formatClock,
  formatDayDate,
  formatDayLabel,
  formatHourLabel,
  formatHourRange,
  formatPct,
  formatPrecip,
  formatPressure,
  formatTemp,
  formatVisibility,
  formatWind,
  hourlyRainLabel,
  tempWarmthT,
  uvLabel,
  windComfortLabel,
} from "../../src/lib/weather/format";

describe("tempWarmthT", () => {
  test("freezing maps to fully cold", () => {
    expect(tempWarmthT(0)).toBe(0);
    expect(tempWarmthT(-15)).toBe(0);
  });

  test("35 °C and above maps to fully warm", () => {
    expect(tempWarmthT(35)).toBe(1);
    expect(tempWarmthT(41)).toBe(1);
  });

  test("midpoint is halfway between cold and warm", () => {
    expect(tempWarmthT(17.5)).toBeCloseTo(0.5);
  });
});

describe("convertTempC", () => {
  test("freezing point", () => {
    expect(convertTempC(0, "imperial")).toBe(32);
  });

  test("scale crossover", () => {
    expect(convertTempC(-40, "imperial")).toBe(-40);
  });

  test("body temperature stays unrounded until display", () => {
    expect(convertTempC(36.6, "imperial")).toBeCloseTo(97.88);
  });

  test("metric is identity", () => {
    expect(convertTempC(21.4, "metric")).toBe(21.4);
  });
});

describe("formatTemp", () => {
  test("null renders en dash", () => {
    expect(formatTemp(null, "metric")).toBe("–");
    expect(formatTemp(null, "imperial")).toBe("–");
  });

  test("rounds converted value and appends degree sign", () => {
    expect(formatTemp(0, "imperial")).toBe("32°");
    expect(formatTemp(-40, "imperial")).toBe("-40°");
    expect(formatTemp(36.6, "imperial")).toBe("98°");
    expect(formatTemp(21.4, "metric")).toBe("21°");
    expect(formatTemp(-3.6, "metric")).toBe("-4°");
  });
});

describe("formatWind", () => {
  test("null speed renders en dash regardless of direction", () => {
    expect(formatWind(null, 315, "metric")).toBe("–");
  });

  test("metric speed with compass point", () => {
    expect(formatWind(12, 315, "metric")).toBe("12 km/h NW");
  });

  test("imperial converts km/h to mph", () => {
    expect(formatWind(12, 315, "imperial")).toBe("7 mph NW");
  });

  test("null direction omits compass", () => {
    expect(formatWind(12, null, "metric")).toBe("12 km/h");
    expect(formatWind(12, null, "imperial")).toBe("7 mph");
  });

  test("compass spot checks incl. round-half boundaries of deg/22.5", () => {
    const point = (deg: number) => formatWind(0, deg, "metric").split(" ").pop();
    expect(point(0)).toBe("N");
    expect(point(11)).toBe("N");
    expect(point(12)).toBe("NNE");
    expect(point(22)).toBe("NNE");
    expect(point(23)).toBe("NNE");
    expect(point(34)).toBe("NE");
    expect(point(45)).toBe("NE");
    expect(point(90)).toBe("E");
    expect(point(135)).toBe("SE");
    expect(point(180)).toBe("S");
    expect(point(202)).toBe("SSW");
    expect(point(203)).toBe("SSW");
    expect(point(214)).toBe("SW");
    expect(point(225)).toBe("SW");
    expect(point(270)).toBe("W");
    expect(point(315)).toBe("NW");
    expect(point(337)).toBe("NNW");
    expect(point(359)).toBe("N");
    expect(point(360)).toBe("N");
  });
});

describe("formatPrecip", () => {
  test("null renders en dash", () => {
    expect(formatPrecip(null, "metric")).toBe("–");
    expect(formatPrecip(null, "imperial")).toBe("–");
  });

  test("metric keeps one decimal, trims bare .0", () => {
    expect(formatPrecip(2.5, "metric")).toBe("2.5 mm");
    expect(formatPrecip(3, "metric")).toBe("3 mm");
    expect(formatPrecip(12.34, "metric")).toBe("12.3 mm");
    expect(formatPrecip(0, "metric")).toBe("0 mm");
  });

  test("imperial renders inches at two decimals", () => {
    expect(formatPrecip(25.4, "imperial")).toBe("1.00 in");
    expect(formatPrecip(2.54, "imperial")).toBe("0.10 in");
  });
});

describe("formatPct", () => {
  test("null renders en dash", () => {
    expect(formatPct(null)).toBe("–");
  });

  test("rounds to whole percent", () => {
    expect(formatPct(62.4)).toBe("62%");
    expect(formatPct(50.5)).toBe("51%");
    expect(formatPct(0)).toBe("0%");
  });
});

describe("formatClock", () => {
  test("12h: positive offset: 06:07Z at UTC+9 is 3:07 PM local", () => {
    expect(formatClock("2026-08-24T06:07:00Z", 9 * 3600, "12h")).toBe("3:07 PM");
  });

  test("12h: negative offset crosses midnight backwards: 06:07Z at UTC-7 is 11:07 PM", () => {
    expect(formatClock("2026-08-24T06:07:00Z", -7 * 3600, "12h")).toBe("11:07 PM");
  });

  test("12h: noon edge renders 12 PM", () => {
    expect(formatClock("2026-08-24T03:00:00Z", 9 * 3600, "12h")).toBe("12:00 PM");
  });

  test("12h: early morning renders 1 AM without leading zero", () => {
    expect(formatClock("2026-08-24T16:00:00Z", 9 * 3600, "12h")).toBe("1:00 AM");
  });

  test("12h: midnight renders 12 AM", () => {
    expect(formatClock("2026-08-24T00:00:00Z", 0, "12h")).toBe("12:00 AM");
  });

  test("24h: afternoon renders zero-padded HH:MM", () => {
    expect(formatClock("2026-08-24T14:05:00Z", 0, "24h")).toBe("14:05");
  });

  test("24h: positive offset keeps local wall time", () => {
    expect(formatClock("2026-08-24T06:07:00Z", 9 * 3600, "24h")).toBe("15:07");
  });

  test("24h: negative offset crossing midnight wraps below 00", () => {
    expect(formatClock("2026-08-24T06:07:00Z", -7 * 3600, "24h")).toBe("23:07");
  });

  test("24h: midnight and noon render 00:00 and 12:00", () => {
    expect(formatClock("2026-08-24T00:00:00Z", 0, "24h")).toBe("00:00");
    expect(formatClock("2026-08-24T03:00:00Z", 9 * 3600, "24h")).toBe("12:00");
  });
});

describe("formatHourRange", () => {
  test("same meridiem merges into one suffix: 2-5 PM", () => {
    expect(formatHourRange("2026-08-24T14:00:00Z", "2026-08-24T17:00:00Z", 0, "12h")).toBe(
      "2–5 PM",
    );
  });

  test("crossing the meridiem keeps both suffixes: 11 AM-1 PM", () => {
    expect(formatHourRange("2026-08-24T11:00:00Z", "2026-08-24T13:00:00Z", 0, "12h")).toBe(
      "11 AM–1 PM",
    );
  });

  test("24h format is zero-padded HH-HH with no meridiem", () => {
    expect(formatHourRange("2026-08-24T14:00:00Z", "2026-08-24T17:00:00Z", 0, "24h")).toBe("14–17");
  });

  test("respects the UTC offset, not the raw UTC hour", () => {
    expect(formatHourRange("2026-08-24T14:00:00Z", "2026-08-24T17:00:00Z", 9 * 3600, "12h")).toBe(
      "11 PM–2 AM",
    );
  });
});

describe("windComfortLabel", () => {
  test("bands from calm through breezy", () => {
    expect(windComfortLabel(5)).toBe("calm");
    expect(windComfortLabel(15)).toBe("light wind");
    expect(windComfortLabel(30)).toBe("breezy");
  });
});

describe("hourlyRainLabel", () => {
  test("bands from light through heavy", () => {
    expect(hourlyRainLabel(0.5)).toBe("light rain");
    expect(hourlyRainLabel(3)).toBe("rain");
    expect(hourlyRainLabel(10)).toBe("heavy rain");
  });
});

describe("formatHourLabel", () => {
  test("12h: afternoon hour", () => {
    expect(formatHourLabel("2026-08-24T14:07:00Z", 0, "12h")).toBe("2p");
  });

  test("12h: midnight hour renders 12a", () => {
    expect(formatHourLabel("2026-08-24T00:30:00Z", 0, "12h")).toBe("12a");
  });

  test("12h: noon hour renders 12p", () => {
    expect(formatHourLabel("2026-08-24T12:00:00Z", 0, "12h")).toBe("12p");
  });

  test("12h: offset can push label across midnight", () => {
    expect(formatHourLabel("2026-08-24T15:07:00Z", 9 * 3600, "12h")).toBe("12a");
    expect(formatHourLabel("2026-08-24T05:07:00Z", -7 * 3600, "12h")).toBe("10p");
  });

  test("24h: labels are zero-padded two-digit hours", () => {
    expect(formatHourLabel("2026-08-24T14:07:00Z", 0, "24h")).toBe("14");
    expect(formatHourLabel("2026-08-24T05:07:00Z", 0, "24h")).toBe("05");
  });

  test("24h: midnight and noon render 00 and 12", () => {
    expect(formatHourLabel("2026-08-24T00:30:00Z", 0, "24h")).toBe("00");
    expect(formatHourLabel("2026-08-24T12:00:00Z", 0, "24h")).toBe("12");
  });

  test("24h: offsets wrap across midnight", () => {
    expect(formatHourLabel("2026-08-24T15:07:00Z", 9 * 3600, "24h")).toBe("00");
    expect(formatHourLabel("2026-08-24T15:07:00Z", -16 * 3600, "24h")).toBe("23");
  });
});

describe("formatDayLabel", () => {
  test("US DST transition date resolves via pure UTC arithmetic", () => {
    expect(formatDayLabel("2026-03-08")).toBe("Sun");
  });

  test("ordinary dates", () => {
    expect(formatDayLabel("2026-08-24")).toBe("Mon");
    expect(formatDayLabel("2026-01-01")).toBe("Thu");
  });
});

describe("formatDayDate", () => {
  test("long: weekday, abbreviated month, day of month in local wall time", () => {
    expect(formatDayDate("2026-08-26T12:00:00Z", 0, "long")).toBe("Wed Aug 26");
  });

  test("negative offset shifts the calendar day backwards across midnight", () => {
    expect(formatDayDate("2026-08-26T02:00:00Z", -7 * 3600, "long")).toBe("Tue Aug 25");
  });

  test("positive offset shifts the calendar day forwards across midnight", () => {
    expect(formatDayDate("2026-08-26T15:30:00Z", 9 * 3600, "long")).toBe("Thu Aug 27");
  });

  test("short drops the month but keeps the shifted weekday", () => {
    expect(formatDayDate("2026-08-26T12:00:00Z", 0, "short")).toBe("Wed 26");
    expect(formatDayDate("2026-08-26T02:00:00Z", -7 * 3600, "short")).toBe("Tue 25");
  });

  test("unparseable instants render en dash", () => {
    expect(formatDayDate("not-a-date", 0, "long")).toBe("–");
    expect(formatDayDate("not-a-date", 0, "short")).toBe("–");
  });
});

describe("formatVisibility", () => {
  test("null renders double dash regardless of units", () => {
    expect(formatVisibility(null, "metric")).toBe("--");
    expect(formatVisibility(null, "imperial")).toBe("--");
  });

  test("metric renders kilometers at one decimal, trimming bare .0", () => {
    expect(formatVisibility(10000, "metric")).toBe("10 km");
    expect(formatVisibility(14300, "metric")).toBe("14.3 km");
  });

  test("imperial converts meters to miles at one decimal, trimming bare .0", () => {
    expect(formatVisibility(9656, "imperial")).toBe("6 mi");
    expect(formatVisibility(5000, "imperial")).toBe("3.1 mi");
  });

  test("zero stays visible rather than null-like", () => {
    expect(formatVisibility(0, "metric")).toBe("0 km");
    expect(formatVisibility(0, "imperial")).toBe("0 mi");
  });
});

describe("formatPressure", () => {
  test("null renders double dash regardless of units", () => {
    expect(formatPressure(null, "metric")).toBe("--");
    expect(formatPressure(null, "imperial")).toBe("--");
  });

  test("metric rounds to whole hPa", () => {
    expect(formatPressure(1015.2, "metric")).toBe("1015 hPa");
    expect(formatPressure(1015.6, "metric")).toBe("1016 hPa");
    expect(formatPressure(995.4, "metric")).toBe("995 hPa");
  });

  test("imperial converts hPa to inHg at two decimals", () => {
    expect(formatPressure(1013.25, "imperial")).toBe("29.92 inHg");
    expect(formatPressure(1000, "imperial")).toBe("29.53 inHg");
    expect(formatPressure(995, "imperial")).toBe("29.38 inHg");
  });
});

describe("uvLabel", () => {
  test("null renders double dash", () => {
    expect(uvLabel(null)).toBe("--");
  });

  test("threshold bands are inclusive", () => {
    expect(uvLabel(0)).toBe("Low");
    expect(uvLabel(2)).toBe("Low");
    expect(uvLabel(2.5)).toBe("Moderate");
    expect(uvLabel(5)).toBe("Moderate");
    expect(uvLabel(5.5)).toBe("High");
    expect(uvLabel(7)).toBe("High");
    expect(uvLabel(7.5)).toBe("Very high");
    expect(uvLabel(10)).toBe("Very high");
    expect(uvLabel(10.1)).toBe("Extreme");
    expect(uvLabel(14)).toBe("Extreme");
  });
});
