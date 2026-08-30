export const FFI_MIN_NODE = [26, 4, 0] as const;

export interface FfiRuntimeInfo {
  bunVersion?: string;
  nodeVersion: string;
  hasFlags: boolean;
}

function parseVersionPart(part: string): number {
  const n = Number(part);
  return Number.isFinite(n) ? n : 0;
}

function nodeAtLeast(version: string, min: readonly number[]): boolean {
  const cleaned = version.startsWith("v") ? version.slice(1) : version;
  const parts = cleaned.split(".").map(parseVersionPart);
  for (let i = 0; i < min.length; i++) {
    const have = parts[i] ?? 0;
    const need = min[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

export function isFfiAvailable(info: FfiRuntimeInfo): boolean {
  if (info.bunVersion !== undefined && info.bunVersion !== "") return true;
  if (info.hasFlags) return true;
  return nodeAtLeast(info.nodeVersion, FFI_MIN_NODE);
}

export function formatFfiUnavailableMessage(nodeVersion: string): string {
  return `interactive TUI requires Bun or Node >= 26.4 (detected node ${nodeVersion}) — CLI-only flags (--version, --one-line) still work`;
}

export async function probeFfiAvailable(): Promise<boolean> {
  const bunVersion = (process.versions as Record<string, string | undefined>).bun;
  if (bunVersion !== undefined && bunVersion !== "") return true;
  try {
    await import("node:ffi");
    return true;
  } catch {
    return false;
  }
}
