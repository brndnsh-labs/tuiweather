import { rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type CapturedFrame, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/app/App";
import { createStoreInstance } from "../src/app/store";
import { saveConfig } from "../src/lib/config/save";
import { tuiConfigSchema } from "../src/lib/config/schema";
import { normalizeForecast } from "../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../src/lib/providers/openmeteo/schemas";
import { displayWidth } from "../src/lib/weather/format";
import portland from "../test/fixtures/openmeteo/portland.json";
import tokyo from "../test/fixtures/openmeteo/tokyo.json";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    light: { type: "boolean", default: false },
    capture: { type: "string" },
    width: { type: "string", default: "120" },
    height: { type: "string", default: "40" },
  },
});
const width = Number(values.width);
const height = Number(values.height);
if (
  !Number.isInteger(width) ||
  !Number.isInteger(height) ||
  width < 1 ||
  height < 1 ||
  width > 300 ||
  height > 100
) {
  throw new Error("Preview dimensions must be 1–300 columns and 1–100 rows.");
}

const forecasts = [portland, tokyo].map((fixture) =>
  normalizeForecast(forecastResponseSchema.parse(fixture)),
);
const nowUtc = "2026-09-02T12:45:00.000Z";
const previewDir = await mkdtemp(join(tmpdir(), "tuiweather-preview-"));
process.once("exit", () => rmSync(previewDir, { recursive: true, force: true }));
const configPath = join(previewDir, "config.toml");
await saveConfig(
  tuiConfigSchema.parse({
    schema_version: 4,
    theme: "night",
    units: "imperial",
    daily_days: 14,
    hourly_hours: 48,
    default_location: "portland",
    locations: [
      { slug: "portland", label: "Portland", latitude: 45.5202, longitude: -122.6765 },
      { slug: "tokyo", label: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
    ],
  }),
  configPath,
);
const store = createStoreInstance({
  configPath,
  fetchForecast: async (location) => {
    const forecast = forecasts[location.longitude > 0 ? 1 : 0];
    if (!forecast) throw new Error("Preview fixture missing");
    return { forecast, stale: false };
  },
  fetchAirQuality: async () => ({ usAqi: null, observedAtUtc: nowUtc }),
  searchLocations: async () => [],
});
const appearance = { ink: values.light ? ("light" as const) : ("dark" as const), background: null };

function svg(frame: CapturedFrame, text: string): string {
  const cellWidth = 10;
  const cellHeight = 20;
  const inset = 24;
  const escapeXml = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const color = (rgba: { toInts(): [number, number, number, number] }) => {
    const [r, g, b] = rgba.toInts();
    return `rgb(${r},${g},${b})`;
  };
  const elements: string[] = [];
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  const textRows = text.split("\n");
  frame.lines.forEach((line, row) => {
    let col = 0;
    const colors: { fg: string; attributes: number }[] = [];
    for (const span of line.spans) {
      const x = inset + col * cellWidth;
      const y = inset + row * cellHeight;
      const spanWidth = span.width * cellWidth;
      elements.push(
        `<rect x="${x}" y="${y}" width="${spanWidth}" height="${cellHeight}" fill="${color(span.bg)}"/>`,
      );
      for (let cell = 0; cell < span.width; cell++)
        colors.push({ fg: color(span.fg), attributes: span.attributes });
      col += span.width;
    }
    col = 0;
    for (const { segment } of segmenter.segment(textRows[row] ?? "")) {
      const cells = displayWidth(segment);
      const style = colors[col];
      if (segment.trim() && style)
        elements.push(
          `<text x="${inset + col * cellWidth}" y="${inset + row * cellHeight + 16}" fill="${style.fg}" textLength="${cells * cellWidth}" lengthAdjust="spacingAndGlyphs"${style.attributes & 1 ? ' font-weight="bold"' : ""}>${escapeXml(segment)}</text>`,
        );
      col += cells;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.cols * cellWidth + inset * 2}" height="${frame.rows * cellHeight + inset * 2}"><rect width="100%" height="100%" fill="${values.light ? "#f0f5f7" : "#0b1520"}"/><g font-family="DejaVu Sans Mono, monospace" font-size="16" xml:space="preserve">${elements.join("")}</g></svg>`;
}

if (values.capture) {
  const setup = await testRender(
    <App store={store} nowMs={Date.parse(nowUtc)} nowUtc={nowUtc} appearance={appearance} />,
    { width, height },
  );
  try {
    const deadline = Date.now() + 3000;
    while (store.getState().forecastBySlug.tokyo === undefined && Date.now() < deadline) {
      await Bun.sleep(15);
      await setup.flush();
    }
    if (!store.getState().forecastBySlug.tokyo) throw new Error("Preview did not finish loading");
    await setup.flush();
    await writeFile(values.capture, svg(setup.captureSpans(), setup.captureCharFrame()));
    console.log(setup.captureCharFrame());
  } finally {
    setup.renderer.destroy();
  }
} else {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  renderer.on("destroy", () => store.getState().dispose());
  createRoot(renderer).render(
    <App store={store} nowMs={Date.parse(nowUtc)} nowUtc={nowUtc} appearance={appearance} />,
  );
}
