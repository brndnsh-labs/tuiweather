import type { z } from "zod";
import { ProviderError } from "./types";

function isControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

export function sanitizeText(text: string, maxChars: number): string {
  let out = "";
  for (const ch of text) {
    if (!isControl(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out.slice(0, maxChars);
}

export function errorReason(
  body: unknown,
  schema: z.ZodTypeAny,
  maxChars = 200,
  extractor?: (data: unknown) => string | undefined,
): string | undefined {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return undefined;
  const raw = extractor ? extractor(parsed.data) : (parsed.data as { reason?: unknown }).reason;
  if (typeof raw !== "string") return undefined;
  return sanitizeText(raw, maxChars);
}

export function causeSuffix(cause: unknown): string {
  let raw = "";
  if (cause instanceof Error) {
    const inner = (cause as Error & { cause?: unknown }).cause;
    if (inner instanceof Error) raw = inner.message;
    else if (typeof inner === "string") raw = inner;
    else if (cause.message !== "fetch failed") raw = cause.message;
  } else if (typeof cause === "string") {
    raw = cause;
  } else if (
    cause !== null &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof (cause as { message: unknown }).message === "string"
  ) {
    raw = (cause as { message: string }).message;
  }
  const sanitized = sanitizeText(raw, 200).trim();
  if (!sanitized) return "";
  return `: ${sanitized}`;
}

export function httpError(
  status: number,
  body: unknown,
  opts: {
    label: string;
    providerId: string;
    schema: z.ZodTypeAny;
    maxChars?: number;
    extractor?: (data: unknown) => string | undefined;
  },
): ProviderError {
  const reason = errorReason(body, opts.schema, opts.maxChars ?? 200, opts.extractor);
  return new ProviderError(
    `${opts.providerId} ${opts.label} failed (HTTP ${status})${reason ? `: ${reason}` : ""}`,
    opts.providerId,
  );
}

export const PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

function sizeCapError(providerId: string, label: string, cap: number): ProviderError {
  return new ProviderError(
    `${providerId} ${label} response exceeded size limit (${cap} bytes)`,
    providerId,
  );
}

export async function readJsonCapped(
  res: Response,
  opts: { providerId: string; label: string; maxBytes?: number },
): Promise<unknown> {
  const cap = opts.maxBytes ?? PROVIDER_RESPONSE_MAX_BYTES;
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const trimmed = contentLength.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed) && parsed > cap) {
        try {
          await res.body?.cancel();
        } catch {}
        throw sizeCapError(opts.providerId, opts.label, cap);
      }
    }
  }

  let bytes: Uint8Array;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > cap) {
          try {
            await reader.cancel();
          } catch {}
          throw sizeCapError(opts.providerId, opts.label, cap);
        }
        chunks.push(value);
      }
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const text = await res.text();
    const encoded = new TextEncoder().encode(text);
    if (encoded.byteLength > cap) {
      throw sizeCapError(opts.providerId, opts.label, cap);
    }
    bytes = encoded;
  }

  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ProviderError(
      `${opts.providerId} ${opts.label} returned a non-JSON body (HTTP ${res.status})`,
      opts.providerId,
      cause,
    );
  }
}
