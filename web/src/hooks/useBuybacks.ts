import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBuybackEvents, type AppContext, type BuybackEvent } from '../chain';
import { BUYBACK_EVENT_LIMIT, HOOK_DEPLOYMENT_BLOCK } from '../config';
import { describeError } from '../format';

export interface BuybacksApi {
  events: BuybackEvent[];
  loading: boolean;
  error: string | null;
  scannedTo: bigint | null;
}

function mergeNewest(existing: BuybackEvent[], incoming: BuybackEvent[], limit: number): BuybackEvent[] {
  const seen = new Set(existing.map((e) => `${e.transactionHash}:${e.logIndex}`));
  const merged = [...existing];
  for (const event of incoming) {
    const id = `${event.transactionHash}:${event.logIndex}`;
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(event);
    }
  }
  return merged
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
    .slice(0, limit);
}

/**
 * Keeps the newest Buyback events for the pool. The first pass walks back
 * from the latest block; later passes only scan blocks that arrived since.
 */
export function useBuybacks(ctx: AppContext | null, latestBlock: bigint | null, limit: number = BUYBACK_EVENT_LIMIT): BuybacksApi {
  const [events, setEvents] = useState<BuybackEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedTo, setScannedTo] = useState<bigint | null>(null);
  const scannedRef = useRef<bigint | null>(null);
  const busy = useRef(false);

  const scan = useCallback(
    async (toBlock: bigint) => {
      if (!ctx || busy.current) return;
      const from = scannedRef.current === null ? HOOK_DEPLOYMENT_BLOCK : scannedRef.current + 1n;
      if (toBlock < from) return;
      busy.current = true;
      try {
        const found = await fetchBuybackEvents(ctx, from, toBlock, limit);
        setEvents((prev) => mergeNewest(prev, found, limit));
        scannedRef.current = toBlock;
        setScannedTo(toBlock);
        setError(null);
      } catch (err) {
        setError(`Unable to load buyback history: ${describeError(err)}`);
      } finally {
        setLoading(false);
        busy.current = false;
      }
    },
    [ctx, limit],
  );

  useEffect(() => {
    if (latestBlock !== null) void scan(latestBlock);
  }, [latestBlock, scan]);

  return { events, loading, error, scannedTo };
}
