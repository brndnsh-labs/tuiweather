import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { MIN_WIDTH, type Tier, tierFor } from "./breakpoints";

export interface ViewportInfo {
  width: number;
  height: number;
  tier: Tier;
  clamped: boolean;
}

export interface TrailingScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: TrailingScheduler = {
  setTimeout(fn, ms) {
    return setTimeout(fn, ms);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface DebouncedTrailing<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}

export function debounceTrailing<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  scheduler: TrailingScheduler = defaultScheduler,
): DebouncedTrailing<A> {
  let timer: unknown = null;
  let pending: A | null = null;

  const run = () => {
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };

  const debounced = (...args: A) => {
    pending = args;
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = scheduler.setTimeout(run, ms);
  };
  debounced.cancel = () => {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
    pending = null;
  };
  debounced.flush = () => {
    if (timer === null) return;
    scheduler.clearTimeout(timer);
    run();
  };
  return debounced as DebouncedTrailing<A>;
}

function snapshot(width: number, height: number): ViewportInfo {
  return { width, height, tier: tierFor(width), clamped: width < MIN_WIDTH };
}

export function useViewport(debounceMs = 100): ViewportInfo {
  const dims = useTerminalDimensions();
  const [view, setView] = useState<ViewportInfo>(() => snapshot(dims.width, dims.height));
  const appliedRef = useRef(view);

  useEffect(() => {
    const target = snapshot(dims.width, dims.height);
    const applied = appliedRef.current;
    if (
      applied.width === target.width &&
      applied.height === target.height &&
      applied.tier === target.tier
    ) {
      return;
    }
    const schedule = debounceTrailing(() => {
      appliedRef.current = target;
      setView(target);
    }, debounceMs);
    schedule();
    return () => schedule.cancel();
  }, [dims.width, dims.height, debounceMs]);

  return view;
}
