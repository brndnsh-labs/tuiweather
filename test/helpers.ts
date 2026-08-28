import type { AirQualityFetcher } from "../src/app/store";
import type { AirQuality } from "../src/lib/weather/types";

export const STUB_AIR_QUALITY_ISO = "2026-08-24T16:15:00.000Z";

export const stubNullAirQuality: AirQuality = {
  usAqi: null,
  pm25UgM3: null,
  ozoneUgM3: null,
  observedAtUtc: STUB_AIR_QUALITY_ISO,
};

export const stubNullAirQualityFetcher: AirQualityFetcher = () =>
  Promise.resolve(stubNullAirQuality);
