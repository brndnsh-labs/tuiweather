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
): string | undefined {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return undefined;
  const reason = (parsed.data as { reason?: unknown }).reason;
  if (typeof reason !== "string") return undefined;
  return sanitizeText(reason, maxChars);
}

export function httpError(
  status: number,
  body: unknown,
  opts: { label: string; providerId: string; schema: z.ZodTypeAny; maxChars?: number },
): ProviderError {
  const reason = errorReason(body, opts.schema, opts.maxChars ?? 200);
  return new ProviderError(
    `${opts.providerId} ${opts.label} failed (HTTP ${status})${reason ? `: ${reason}` : ""}`,
    opts.providerId,
  );
}
