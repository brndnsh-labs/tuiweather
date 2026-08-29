import { useKeyboard } from "@opentui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { LocationEntry, SearchLocationsFn, WeatherStore } from "../../app/store";
import type { GeocodingResult } from "../../lib/providers/types";
import { displayWidth, truncateCells } from "../../lib/weather/format";
import { usePalette } from "../../theme/tokens";

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_BOX_WIDTH = 60;
export const SEARCH_BOX_HEIGHT = 10;
const SEARCH_MAX_RESULTS = 4;

interface SearchOverlayProps {
  store: WeatherStore;
  width: number;
  height: number;
}

interface LocationPickerProps {
  searchLocations: SearchLocationsFn;
  width: number;
  height: number;
  title?: string;
  footer?: string;
  busy?: boolean;
  actionError?: string;
  onQueryChange?: () => void;
  onSelect(result: GeocodingResult): void;
  onCancel(): void;
}

type SearchStatus = "idle" | "searching" | "error" | "empty" | "results";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function truncateTo(text: string, width: number): string {
  return truncateCells(text, width);
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
  const region = result.admin1 ?? result.country_code ?? "";
  const label = region.length > 0 ? `${result.name}, ${region}` : result.name;
  return {
    slug: uniqueSlug(
      slugifyCandidate(result.name, result.admin1, result.country_code),
      existingSlugs,
    ),
    label: truncateCells(label.length > 0 ? label : "unnamed", 80),
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

export function resultLine(result: GeocodingResult, selected: boolean, width: number): string {
  const right = formatCoords(result.latitude, result.longitude);
  const leftRaw = `${result.name} · ${regionText(result)}`;
  const prefix = selected ? "›" : " ";
  const avail = Math.max(0, width - displayWidth(prefix) - 1 - displayWidth(right));
  const left = truncateTo(leftRaw, avail);
  const padded = `${left}${" ".repeat(Math.max(0, avail - displayWidth(left)))}`;
  return `${prefix} ${padded}${right}`;
}

export function LocationPicker({
  searchLocations,
  width,
  height,
  title = "search location",
  footer = "enter select · ↑↓ navigate · esc cancel",
  busy = false,
  actionError,
  onQueryChange,
  onSelect,
  onCancel,
}: LocationPickerProps) {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const requestIdRef = useRef(0);
  const boxWidth = Math.max(1, Math.min(SEARCH_BOX_WIDTH, width >= 32 ? width - 2 : width));
  const boxHeight = Math.max(1, Math.min(SEARCH_BOX_HEIGHT, height));
  const innerWidth = Math.max(1, boxWidth - 2);
  const visibleLimit = Math.max(1, Math.min(SEARCH_MAX_RESULTS, boxHeight - 6));
  const visible = results.slice(0, visibleLimit);
  const visibleCount = visible.length;

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
      onCancel();
      return;
    }
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(Math.max(0, visibleCount - 1), c + 1));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      if (busy || visibleCount === 0) return;
      const chosen = visible[Math.min(cursor, visibleCount - 1)];
      if (chosen) onSelect(chosen);
    }
  });

  let body: ReactNode;
  if (busy) {
    body = (
      <text fg={palette.fgDim} bg={palette.surface}>
        saving…
      </text>
    );
  } else if (actionError) {
    body = (
      <text fg={palette.danger} bg={palette.surface}>
        {truncateTo(actionError, innerWidth)}
      </text>
    );
  } else if (status === "results") {
    body = visible.map((result, i) => (
      <text
        key={`${result.id}`}
        fg={i === cursor ? palette.accent : palette.fg}
        bg={palette.surface}
      >
        {resultLine(result, i === cursor, innerWidth)}
      </text>
    ));
  } else if (status === "searching") {
    body = (
      <text fg={palette.fgDim} bg={palette.surface}>
        searching…
      </text>
    );
  } else if (status === "error") {
    body = (
      <text fg={palette.danger} bg={palette.surface}>
        {truncateTo(errorMsg ?? "search failed", innerWidth)}
      </text>
    );
  } else if (status === "empty") {
    body = (
      <text fg={palette.fgDim} bg={palette.surface}>
        no matches
      </text>
    );
  } else {
    body = (
      <text fg={palette.fgDim} bg={palette.surface}>
        type to search
      </text>
    );
  }

  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = Math.max(0, Math.floor((height - boxHeight) / 2));

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={boxWidth}
      height={boxHeight}
      zIndex={10}
      border
      borderColor={palette.accent}
      backgroundColor={palette.surface}
      title={truncateTo(title, innerWidth)}
      flexDirection="column"
    >
      <input
        focused
        onInput={(value) => {
          onQueryChange?.();
          setQuery(value);
        }}
        width={innerWidth}
        backgroundColor={palette.surface}
        textColor={palette.fg}
        focusedTextColor={palette.fg}
        placeholderColor={palette.fgDim}
      />
      <text fg={palette.border} bg={palette.surface}>
        {"─".repeat(innerWidth)}
      </text>
      {body}
      <box flexGrow={1} backgroundColor={palette.surface} />
      <text fg={palette.border} bg={palette.surface}>
        {"─".repeat(innerWidth)}
      </text>
      <text fg={palette.fgDim} bg={palette.surface}>
        {truncateTo(footer, innerWidth)}
      </text>
    </box>
  );
}

export function SearchOverlay({ store, width, height }: SearchOverlayProps) {
  const searchLocations = store((s) => s.searchLocations);
  return (
    <LocationPicker
      searchLocations={searchLocations}
      width={width}
      height={height}
      onCancel={() => store.getState().setOverlayOpen(false)}
      onSelect={(chosen) => {
        const state = store.getState();
        const entry = buildLocationEntry(
          chosen,
          state.config.locations.map((loc) => loc.slug),
        );
        void state.addLocation(entry).then(() => state.setOverlayOpen(false));
      }}
    />
  );
}
