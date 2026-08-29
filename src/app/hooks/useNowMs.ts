import { useEffect, useState } from "react";
import { TICK_INTERVAL_MS } from "../tick";

export function useNowMs(propsNowMs?: number): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (propsNowMs !== undefined) return;
    const h = setInterval(() => setTick((v) => v + 1), TICK_INTERVAL_MS);
    (h as unknown as { unref?: () => void }).unref?.();
    return () => clearInterval(h);
  }, [propsNowMs]);
  return propsNowMs ?? Date.now();
}
