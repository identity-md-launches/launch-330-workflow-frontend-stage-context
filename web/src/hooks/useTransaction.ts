import { useCallback, useState } from 'react';
import type { Hex, PublicClient, WalletClient } from 'viem';
import { describeError } from '../format';
import { isUserRejection } from '../wallet';

export type TxPhase = 'idle' | 'simulating' | 'signing' | 'pending' | 'confirmed' | 'reverted' | 'failed' | 'rejected';

export interface TxState {
  phase: TxPhase;
  hash: Hex | null;
  message: string | null;
}

export interface TxRunner {
  state: TxState;
  busy: boolean;
  reset: () => void;
  /**
   * Runs simulate → sign → wait. `simulate` must throw with the revert reason
   * when the call would fail, and `send` returns the transaction hash.
   */
  run: (steps: { simulate: () => Promise<void>; send: () => Promise<Hex>; onConfirmed?: () => void | Promise<void> }) => Promise<void>;
}

const IDLE: TxState = { phase: 'idle', hash: null, message: null };

/** Small state machine shared by every transaction control on the page. */
export function useTransaction(client: PublicClient | null, walletClient: WalletClient | null): TxRunner {
  const [state, setState] = useState<TxState>(IDLE);
  const busy = state.phase === 'simulating' || state.phase === 'signing' || state.phase === 'pending';

  const run = useCallback<TxRunner['run']>(
    async ({ simulate, send, onConfirmed }) => {
      if (!client || !walletClient) {
        setState({ phase: 'failed', hash: null, message: 'Connect a wallet on the deployment network first.' });
        return;
      }
      setState({ phase: 'simulating', hash: null, message: 'Checking that the transaction would succeed…' });
      try {
        await simulate();
      } catch (error) {
        setState({ phase: 'failed', hash: null, message: `Simulation failed: ${describeError(error)}` });
        return;
      }
      setState({ phase: 'signing', hash: null, message: 'Confirm the transaction in your wallet.' });
      let hash: Hex;
      try {
        hash = await send();
      } catch (error) {
        if (isUserRejection(error)) {
          setState({ phase: 'rejected', hash: null, message: 'Transaction was rejected in the wallet. Nothing was sent.' });
        } else {
          setState({ phase: 'failed', hash: null, message: `Unable to send: ${describeError(error)}` });
        }
        return;
      }
      setState({ phase: 'pending', hash, message: 'Transaction sent. Waiting for confirmation…' });
      try {
        const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
        if (receipt.status === 'success') {
          setState({ phase: 'confirmed', hash, message: 'Transaction confirmed.' });
          await onConfirmed?.();
        } else {
          setState({ phase: 'reverted', hash, message: 'Transaction reverted on-chain. State did not change; check the explorer link for details.' });
        }
      } catch (error) {
        setState({ phase: 'failed', hash, message: `Unable to confirm the transaction: ${describeError(error)}` });
      }
    },
    [client, walletClient],
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { state, busy, reset, run };
}
