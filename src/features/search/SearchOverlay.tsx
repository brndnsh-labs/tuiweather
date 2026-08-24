import { useKeyboard } from "@opentui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { LocationEntry, WeatherStore } from "../../app/store";
import type { GeocodingResult } from "../../lib/providers/openmeteo/geocoding";
import { usePalette } from "../../theme/tokens";

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_BOX_WIDTH = 60;
export const SEARCH_BOX_HEIGHT = 10;
const SEARCH_BOX_INNER = SEARCH_BOX_WIDTH - 2;
const SEARCH_MAX_RESULTS = 4;

interface SearchOverlayProps {
  store: WeatherStore;
  width: number;
  height: number;
}

type SearchStatus = "idle" | "searching" | "error" | "empty" | "results";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function truncateTo(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function slugifyCandidate(
  name: string,
  admin1: string | undefined,
  countryCode: string | undefined,
): string {
  const raw = `${name}${admin1 ? `-${admin1}` : ""}-${countryCode ?? ""}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "location";
}

export function uniqueSlug(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function buildLocationEntry(
  result: GeocodingResult,
  existingSlugs: readonly string[],
): LocationEntry {
  const region = result.country_code ?? result.admin1 ?? "";
  const label = region.length > 0 ? `${result.name}, ${region}` : result.name;
  return {
    slug: uniqueSlug(
      slugifyCandidate(result.name, result.admin1, result.country_code),
      existingSlugs,
    ),
    label: (label.length > 0 ? label : "unnamed").slice(0, 80),
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

export function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
}

function regionText(result: GeocodingResult): string {
  const main = result.admin1 ?? result.country ?? "";
  const suffix = result.country_code ? `, ${result.country_code}` : "";
  return `${main}${suffix}`;
}

function resultLine(result: GeocodingResult, selected: boolean): string {
  const right = formatCoords(result.latitude, result.longitude);
  const leftRaw = `${result.name} · ${regionText(result)}`;
  const avail = Math.max(0, SEARCH_BOX_INNER - 2 - right.length);
  const left = truncateTo(leftRaw, avail).padEnd(avail);
  const prefix = selected ? "›" : " ";
  return `${prefix} ${left}${right}`.slice(0, SEARCH_BOX_INNER);
}

export function SearchOverlay({ store, width, height }: SearchOverlayProps) {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const requestIdRef = useRef(0);
  const searchLocations = store((s) => s.searchLocations);
  const visibleCount = Math.min(results.length, SEARCH_MAX_RESULTS);
  const visible = results.slice(0, SEARCH_MAX_RESULTS);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setStatus("idle");
      setResults([]);
      setErrorMsg(undefined);
      setCursor(0);
      return;
    }
    const id = ++requestIdRef.current;
    setStatus("searching");
    const timer = setTimeout(() => {
      void searchLocations(q).then(
        (found) => {
          if (requestIdRef.current !== id) return;
          setResults(found);
          setErrorMsg(undefined);
          setCursor(0);
          setStatus(found.length > 0 ? "results" : "empty");
        },
        (e: unknown) => {
          if (requestIdRef.current !== id) return;
          setResults([]);
          setErrorMsg(errorMessage(e));
          setStatus("error");
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      requestIdRef.current += 1;
    };
  }, [query, searchLocations]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.getState().setOverlayOpen(false);
      return;
    }
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(visibleCount - 1, c + 1));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      if (visibleCount === 0) return;
      const idx = Math.min(cursor, visibleCount - 1);
      const chosen = results[idx];
      if (!chosen) return;
      const s = store.getState();
      const entry = buildLocationEntry(
        chosen,
        s.config.locations.map((loc) => loc.slug),
      );
      void s.addLocation(entry).then(() => s.setOverlayOpen(false));
    }
  });

  const left = Math.max(0, Math.floor((width - SEARCH_BOX_WIDTH) / 2));
  const top = Math.max(0, Math.floor((height - SEARCH_BOX_HEIGHT) / 2));

  let body: ReactNode;
  if (status === "results") {
    body = visible.map((result, i) => (
      <text key={`${result.id}`} fg={i === cursor ? palette.accent : palette.fg} bg="#16161e">
        {resultLine(result, i === cursor)}
      </text>
    ));
  } else if (status === "searching") {
    body = (
      <text fg={palette.fgDim} bg="#16161e">
        searching…
      </text>
    );
  } else if (status === "error") {
    body = (
      <text fg={palette.danger} bg="#16161e">
        {truncateTo(errorMsg ?? "search failed", SEARCH_BOX_INNER)}
      </text>
    );
  } else if (status === "empty") {
    body = (
      <text fg={palette.fgDim} bg="#16161e">
        no matches
      </text>
    );
  } else {
    body = (
      <text fg={palette.fgDim} bg="#16161e">
        type to search
      </text>
    );
  }

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={SEARCH_BOX_WIDTH}
      height={SEARCH_BOX_HEIGHT}
      zIndex={10}
      border
      borderColor={palette.accent}
      backgroundColor="#16161e"
      title="search location"
      flexDirection="column"
    >
      <input focused onInput={setQuery} width={SEARCH_BOX_INNER} backgroundColor="#16161e" />
      <text fg={palette.border} bg="#16161e">
        {"─".repeat(SEARCH_BOX_INNER)}
      </text>
      {body}
      <box flexGrow={1} backgroundColor="#16161e" />
      <text fg={palette.border} bg="#16161e">
        {"─".repeat(SEARCH_BOX_INNER)}
      </text>
      <text fg={palette.fgDim} bg="#16161e">
        {"enter select · ↑↓ navigate · esc cancel"}
      </text>
    </box>
  );
}
