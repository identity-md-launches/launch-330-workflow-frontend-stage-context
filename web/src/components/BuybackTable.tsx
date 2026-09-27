import type { BuybackEvent } from '../chain';
import { BUYBACK_EVENT_LIMIT, TOKEN } from '../config';
import { explorerBlock, explorerTx, formatAmount, shortHash } from '../format';
import type { BuybacksApi } from '../hooks/useBuybacks';
import { Spinner, StatusMessage } from './Status';

interface Props {
  buybacks: BuybacksApi;
  explorer: string;
  nativeSymbol: string;
  nativeDecimals: number;
}

/** Last N Buyback events for the pool, newest first. */
export function BuybackTable({ buybacks, explorer, nativeSymbol, nativeDecimals }: Props) {
  const { events, loading, error } = buybacks;
  return (
    <section className="card" aria-labelledby="history-heading">
      <div className="card-header">
        <h2 id="history-heading">Recent buybacks</h2>
        <p className="card-subtitle">The last {BUYBACK_EVENT_LIMIT} Buyback events emitted by the hook for this pool.</p>
      </div>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {loading && events.length === 0 ? (
        <p className="muted">
          <Spinner /> Loading buyback history…
        </p>
      ) : events.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No buybacks yet</p>
          <p className="muted">
            Buybacks appear here after someone runs one. Fees from sells and exact-output buys accrue as pending {nativeSymbol} until the minimum is reached.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Recent buybacks, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">Transaction</th>
                <th scope="col" className="num">
                  {nativeSymbol} spent
                </th>
                <th scope="col" className="num">
                  {TOKEN.symbol} burned
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event: BuybackEvent) => (
                <tr key={`${event.transactionHash}:${event.logIndex}`}>
                  <td data-label="Block">
                    <a href={explorerBlock(explorer, event.blockNumber)} target="_blank" rel="noreferrer">
                      {event.blockNumber.toString()}
                    </a>
                  </td>
                  <td data-label="Transaction" translate="no">
                    <a href={explorerTx(explorer, event.transactionHash)} target="_blank" rel="noreferrer" title={event.transactionHash}>
                      {shortHash(event.transactionHash)}
                      <span className="sr-only"> (opens the explorer in a new tab)</span>
                    </a>
                  </td>
                  <td data-label={`${nativeSymbol} spent`} className="num">
                    {formatAmount(event.ethSpent, nativeDecimals, 6)}
                  </td>
                  <td data-label={`${TOKEN.symbol} burned`} className="num">
                    {formatAmount(event.tokensBurned, TOKEN.decimals, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
