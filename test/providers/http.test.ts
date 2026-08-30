import { describe, expect, test } from "bun:test";
import {
  errorReason,
  httpError,
  PROVIDER_RESPONSE_MAX_BYTES,
  readJsonCapped,
  sanitizeText,
} from "../../src/lib/providers/http";
import { nwsProblemReason } from "../../src/lib/providers/nws/client";
import { nwsProblemSchema } from "../../src/lib/providers/nws/schemas";
import { apiErrorBodySchema, MAX_REASON_CHARS } from "../../src/lib/providers/openmeteo/schemas";
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

describe("errorReason and httpError unified path", () => {
  test("extracts openmeteo reason and sanitizes", () => {
    const reason = errorReason({ error: true, reason: "bad\x00name" }, apiErrorBodySchema);
    expect(reason).toBe("badname");
  });

  test("openmeteo httpError uses MAX_REASON_CHARS shape", () => {
    const err = httpError(
      400,
      { error: true, reason: "Latitude must be numeric" },
      {
        label: "forecast",
        providerId: "openmeteo",
        schema: apiErrorBodySchema,
        maxChars: MAX_REASON_CHARS,
      },
    );
    expect(err.message).toBe("openmeteo forecast failed (HTTP 400): Latitude must be numeric");
  });

  test("openmeteo httpError omits reason when absent", () => {
    const err = httpError(
      400,
      { error: true },
      {
        label: "forecast",
        providerId: "openmeteo",
        schema: apiErrorBodySchema,
      },
    );
    expect(err.message).toBe("openmeteo forecast failed (HTTP 400)");
  });

  test("clamps a hostile openmeteo reason to MAX_REASON_CHARS", () => {
    const long = "x".repeat(500);
    const err = httpError(
      400,
      { error: true, reason: long },
      {
        label: "forecast",
        providerId: "openmeteo",
        schema: apiErrorBodySchema,
        maxChars: MAX_REASON_CHARS,
      },
    );
    const afterColon = err.message.split(": ")[1] ?? "";
    expect(afterColon.length).toBe(MAX_REASON_CHARS);
  });

  test("extracts nws detail via extractor and falls back to title", () => {
    const withDetail = errorReason(
      { detail: "Point must be rounded", title: "Bad Request" },
      nwsProblemSchema,
      200,
      nwsProblemReason,
    );
    expect(withDetail).toBe("Point must be rounded");

    const withTitle = errorReason({ title: "Not Found" }, nwsProblemSchema, 200, nwsProblemReason);
    expect(withTitle).toBe("Not Found");

    const none = errorReason({ status: 400 }, nwsProblemSchema, 200, nwsProblemReason);
    expect(none).toBeUndefined();
  });

  test("nws httpError uses detail ?? title via extractor", () => {
    const err = httpError(
      400,
      { detail: "Point must be rounded" },
      {
        label: "points",
        providerId: "nws",
        schema: nwsProblemSchema,
        extractor: nwsProblemReason,
      },
    );
    expect(err.message).toBe("nws points failed (HTTP 400): Point must be rounded");

    const err2 = httpError(
      404,
      { title: "Not Found" },
      {
        label: "points",
        providerId: "nws",
        schema: nwsProblemSchema,
        extractor: nwsProblemReason,
      },
    );
    expect(err2.message).toBe("nws points failed (HTTP 404): Not Found");
  });

  test("nws httpError omits reason when neither detail nor title present", () => {
    const err = httpError(
      400,
      { status: 400 },
      {
        label: "points",
        providerId: "nws",
        schema: nwsProblemSchema,
        extractor: nwsProblemReason,
      },
    );
    expect(err.message).toBe("nws points failed (HTTP 400)");
  });

  test("sanitizes control chars in nws detail via unified path", () => {
    const hostile = "\u001b]0;pwned\u0007 bad";
    const err = httpError(
      400,
      { detail: hostile },
      {
        label: "points",
        providerId: "nws",
        schema: nwsProblemSchema,
        extractor: nwsProblemReason,
      },
    );
    expect(err.message.includes("\u001b")).toBe(false);
    expect(err.message.includes("\u0007")).toBe(false);
    expect(err.message).toContain("bad");
  });

  test("httpError sanitizes and clamps to maxChars", () => {
    const long = "a".repeat(500);
    const err = httpError(
      500,
      { error: true, reason: long },
      {
        label: "forecast",
        providerId: "openmeteo",
        schema: apiErrorBodySchema,
        maxChars: 200,
      },
    );
    expect(err.message.length).toBeLessThan(300);
  });

  test("errorReason returns undefined when body does not match schema", () => {
    expect(errorReason({ not: "error" }, apiErrorBodySchema)).toBeUndefined();
    expect(errorReason({ error: true, reason: 123 }, apiErrorBodySchema)).toBeUndefined();
  });

  test("sanitizeText helper strips controls and caps", () => {
    expect(sanitizeText("\u001bhello\u0007", 10)).toBe("hello");
    expect(sanitizeText("x".repeat(500), 200).length).toBe(200);
  });
});
