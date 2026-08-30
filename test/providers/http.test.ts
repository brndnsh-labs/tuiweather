import { describe, expect, test } from "bun:test";
import { PROVIDER_RESPONSE_MAX_BYTES, readJsonCapped } from "../../src/lib/providers/http";
import { ProviderError } from "../../src/lib/providers/types";

function jsonResponse(
  body: string,
  init: ResponseInit & { headers?: Record<string, string> },
): Response {
  const headers = new Headers(init.headers);
  return new Response(body, { ...init, headers });
}

function streamedResponse(
  chunks: Uint8Array[],
  init: ResponseInit & { headers?: Record<string, string> },
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers(init.headers);
  return new Response(stream, { ...init, headers });
}

describe("readJsonCapped", () => {
  test("parses payload under cap (no Content-Length)", async () => {
    const payload = JSON.stringify({ ok: true, value: 42 });
    const res = jsonResponse(payload, { status: 200 });
    const body = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
    });
    expect(body).toEqual({ ok: true, value: 42 });
  });

  test("parses payload under cap with accurate Content-Length", async () => {
    const payload = JSON.stringify({ hello: "world" });
    const res = jsonResponse(payload, {
      status: 200,
      headers: { "content-length": String(Buffer.byteLength(payload)) },
    });
    const body = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
    });
    expect(body).toEqual({ hello: "world" });
  });

  test("parses realistic small forecast JSON under cap", async () => {
    const payload = JSON.stringify({
      latitude: 45.5,
      longitude: -122.7,
      utc_offset_seconds: 0,
      timezone: "GMT",
      current: { time: "2026-08-28T22:00", temperature_2m: 21.5, weather_code: 1 },
      hourly: { time: ["2026-08-28T22:00"], temperature_2m: [21.5] },
      daily: { time: ["2026-08-28"], weather_code: [1] },
    });
    const res = jsonResponse(payload, { status: 200 });
    const body = (await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
    })) as { latitude: number };
    expect(body.latitude).toBe(45.5);
  });

  test("response with no Content-Length under cap works", async () => {
    const payload = JSON.stringify({ data: "x".repeat(100) });
    const res = new Response(payload, { status: 200 });
    expect(res.headers.get("content-length")).toBeNull();
    const body = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
      maxBytes: 1024,
    });
    expect(body).toEqual({ data: "x".repeat(100) });
  });

  test("Content-Length over cap rejects without reading body", async () => {
    const cap = 100;
    const payload = JSON.stringify({ data: "hello" });
    let bodyRead = false;
    const chunk = new TextEncoder().encode(payload);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        bodyRead = true;
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = new Response(stream, {
      status: 200,
      headers: { "content-length": String(cap + 1) },
    });

    const caught: unknown = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
      maxBytes: cap,
    }).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.providerId).toBe("openmeteo");
    expect(error.message).toContain("exceeded size limit");
    expect(error.message).toContain(String(cap));
    expect(bodyRead).toBe(false);
  });

  test("streaming body exceeding cap aborts with ProviderError", async () => {
    const cap = 50;
    const bigPayload = JSON.stringify({ data: "x".repeat(200) });
    expect(Buffer.byteLength(bigPayload)).toBeGreaterThan(cap);
    const res = jsonResponse(bigPayload, { status: 200 });
    const caught: unknown = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
      maxBytes: cap,
    }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.message).toContain("exceeded size limit");
    expect(error.providerId).toBe("openmeteo");
  });

  test("streaming body split across chunks exceeding cap throws", async () => {
    const cap = 30;
    const chunk1 = new TextEncoder().encode('{"a":"');
    const chunk2 = new TextEncoder().encode("x".repeat(40));
    const chunk3 = new TextEncoder().encode('"}');
    const res = streamedResponse([chunk1, chunk2, chunk3], { status: 200 });
    const caught: unknown = await readJsonCapped(res, {
      providerId: "nws",
      label: "points",
      maxBytes: cap,
    }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.message).toContain("exceeded size limit");
    expect(error.providerId).toBe("nws");
  });

  test("payload exactly at cap parses fine", async () => {
    const payload = JSON.stringify({ a: 1 });
    const cap = Buffer.byteLength(payload);
    const res = jsonResponse(payload, { status: 200 });
    const body = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
      maxBytes: cap,
    });
    expect(body).toEqual({ a: 1 });
  });

  test("payload one byte over cap throws", async () => {
    const payload = JSON.stringify({ a: 1 });
    const cap = Buffer.byteLength(payload) - 1;
    const res = jsonResponse(payload, { status: 200 });
    const caught: unknown = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
      maxBytes: cap,
    }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.message).toContain("exceeded size limit");
  });

  test("non-JSON body throws ProviderError with status", async () => {
    const res = jsonResponse("<html>error</html>", { status: 502 });
    const caught: unknown = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
    }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.message).toContain("non-JSON");
    expect(error.message).toContain("502");
    expect(error.providerId).toBe("openmeteo");
  });

  test("invalid Content-Length is ignored and body still parses", async () => {
    for (const bad of ["not-a-number", "1e10", "100, 200", " 12.34 "]) {
      const payload = JSON.stringify({ ok: true });
      const res = jsonResponse(payload, {
        status: 200,
        headers: { "content-length": bad },
      });
      const body = await readJsonCapped(res, {
        providerId: "openmeteo",
        label: "forecast",
        maxBytes: 1000,
      });
      expect(body).toEqual({ ok: true });
    }
  });

  test("Content-Length exactly at cap does not reject", async () => {
    const payload = JSON.stringify({ ok: true });
    const cap = Buffer.byteLength(payload);
    const res = jsonResponse(payload, {
      status: 200,
      headers: { "content-length": String(cap) },
    });
    const body = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
      maxBytes: cap,
    });
    expect(body).toEqual({ ok: true });
  });

  test("returns body even for non-OK status (caller decides)", async () => {
    const payload = JSON.stringify({ error: true, reason: "bad" });
    const res = jsonResponse(payload, { status: 400 });
    const body = await readJsonCapped(res, {
      providerId: "openmeteo",
      label: "forecast",
    });
    expect(body).toEqual({ error: true, reason: "bad" });
  });

  test("PROVIDER_RESPONSE_MAX_BYTES is a few MB", () => {
    expect(PROVIDER_RESPONSE_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    expect(PROVIDER_RESPONSE_MAX_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});
