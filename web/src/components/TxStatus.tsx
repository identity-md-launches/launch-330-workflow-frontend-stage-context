import { explorerTx } from '../format';
import type { TxState } from '../hooks/useTransaction';
import { Spinner, StatusMessage, type Tone } from './Status';

const TONE: Record<TxState['phase'], Tone> = {
  idle: 'neutral',
  simulating: 'info',
  signing: 'info',
  pending: 'info',
  confirmed: 'success',
  reverted: 'error',
  failed: 'error',
  rejected: 'warning',
};

/** Renders the transaction state with an explorer link once a hash exists. */
export function TxStatus({ state, explorer }: { state: TxState; explorer: string }) {
  if (state.phase === 'idle' || !state.message) return null;
  const inFlight = state.phase === 'simulating' || state.phase === 'signing' || state.phase === 'pending';
  return (
    <StatusMessage tone={TONE[state.phase]}>
      {inFlight ? <Spinner /> : null} {state.message}{' '}
      {state.hash ? (
        <a href={explorerTx(explorer, state.hash)} target="_blank" rel="noreferrer">
          View transaction<span className="sr-only"> (opens the explorer in a new tab)</span>
        </a>
      ) : null}
    </StatusMessage>
  );
}
