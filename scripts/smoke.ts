import { fetchForecast } from "../src/lib/providers/openmeteo/client";
import { conditionLabel } from "../src/lib/weather/condition-display";

const PORTLAND = { latitude: 45.5202, longitude: -122.6742 };

if (import.meta.main) {
  const forecast = await fetchForecast(PORTLAND);
  const cur = forecast.current;
  console.log(
    `now: ${Math.round(cur.temperatureC)}°C, ${conditionLabel(cur.condition)}, wind ${Math.round(cur.windSpeedKmh)} km/h (${cur.timeUtc})`,
  );

  const wet = forecast.minutely15.find((bucket) => bucket.precipMm > 0);
  console.log(
    wet
      ? `next precip: ${wet.precipMm} mm during ${wet.startUtc} → ${wet.endUtc}`
      : `next precip: none in minutely window (${forecast.minutely15.length} buckets)`,
  );

  const today = forecast.daily[0];
  if (!today) throw new Error("smoke: no daily data returned");
  const dayStartMs = Date.parse(`${today.dateLocal}T00:00Z`) - forecast.utcOffsetSeconds * 1000;
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const todaysTemps = forecast.hourly
    .filter((point) => {
      const t = Date.parse(point.timeUtc);
      return t >= dayStartMs && t < dayEndMs;
    })
    .map((point) => point.temperatureC);
  if (todaysTemps.length === 0) throw new Error("smoke: no hourly data for today");
  console.log(
    `today (${today.dateLocal}): ${Math.round(Math.min(...todaysTemps))}–${Math.round(Math.max(...todaysTemps))}°C over ${todaysTemps.length} hourly points`,
  );
}
