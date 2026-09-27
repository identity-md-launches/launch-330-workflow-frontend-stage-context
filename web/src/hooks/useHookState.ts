import { useCallback, useEffect, useRef, useState } from 'react';
import { readHookSnapshot, type AppContext, type HookSnapshot } from '../chain';
import { POLL_INTERVAL_MS } from '../config';
import { describeError } from '../format';

export interface HookStateApi {
  snapshot: HookSnapshot | null;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

/** Polls the hook views and pool state on an interval; `refresh` forces a read. */
export function useHookState(ctx: AppContext | null, intervalMs: number = POLL_INTERVAL_MS): HookStateApi {
  const [snapshot, setSnapshot] = useState<HookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const next = await readHookSnapshot(ctx);
        setSnapshot(next);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (err) {
        setError(`Unable to read contract state: ${describeError(err)}`);
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    void refresh();
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [ctx, refresh, intervalMs]);

  return { snapshot, loading, error, updatedAt, refresh };
}
