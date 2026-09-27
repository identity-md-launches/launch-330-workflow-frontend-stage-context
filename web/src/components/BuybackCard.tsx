import { evaluateEligibility, type AppContext, type HookSnapshot } from '../chain';
import { TOKEN } from '../config';
import { formatAmount } from '../format';
import { useTransaction } from '../hooks/useTransaction';
import type { WalletApi } from '../hooks/useWallet';
import { Badge, Spinner, StatusMessage } from './Status';
import { TxStatus } from './TxStatus';

interface Props {
  ctx: AppContext;
  snapshot: HookSnapshot | null;
  wallet: WalletApi;
  refresh: () => Promise<void>;
}

/**
 * The permissionless buyback control. The button is enabled only when the
 * snapshot says the hook would accept the call, a wallet is connected on the
 * deployment chain, and both contracts have code. The call is simulated
 * before the wallet is asked to sign.
 */
export function BuybackCard({ ctx, snapshot, wallet, refresh }: Props) {
  const { network } = ctx;
  const native = network.nativeCurrency;
  const tx = useTransaction(ctx.client, wallet.walletClient);
  const fmtNative = (v: bigint) => formatAmount(v, native.decimals, 6);

  const eligibility = snapshot ? evaluateEligibility(snapshot, native.symbol, fmtNative) : null;
  const contractsLive = snapshot ? snapshot.hookHasCode && snapshot.tokenHasCode : false;

  const blockers: string[] = [];
  if (!snapshot) blockers.push('Waiting for contract state.');
  else if (!contractsLive) blockers.push('Contract code was not found at the deployment addresses on this RPC. Transactions stay disabled.');
  if (wallet.status !== 'connected') blockers.push('Connect a wallet to run a buyback. Any address can call it; the caller only pays gas.');
  else if (!wallet.onTargetChain) blockers.push(`Your wallet is on another network. Switch to ${network.name} first.`);

  const canRun = Boolean(eligibility?.eligible && contractsLive && wallet.onTargetChain && wallet.walletClient && !tx.busy);

  const onRun = () =>
    tx.run({
      simulate: async () => {
        await ctx.client.simulateContract({
          address: ctx.deployment.hook.address,
          abi: ctx.deployment.hookAbi,
          functionName: 'buyback',
          args: [ctx.poolKey],
          account: wallet.account ?? undefined,
        });
      },
      send: async () => {
        const walletClient = wallet.walletClient;
        if (!walletClient || !wallet.account) throw new Error('Wallet is not connected.');
        return walletClient.writeContract({
          address: ctx.deployment.hook.address,
          abi: ctx.deployment.hookAbi,
          functionName: 'buyback',
          args: [ctx.poolKey],
          account: wallet.account,
          chain: ctx.chain,
        });
      },
      onConfirmed: refresh,
    });

  return (
    <section className="card" aria-labelledby="buyback-heading">
      <div className="card-header">
        <h2 id="buyback-heading">Run a buyback</h2>
        <p className="card-subtitle">
          Anyone can trigger a buyback. The hook spends up to {snapshot ? fmtNative(snapshot.maxBuyback) : '0.05'} {native.symbol} of
          pending fees on {TOKEN.symbol} and sends every token it receives to the burn address.
        </p>
      </div>

      <dl className="facts">
        <div className="fact">
          <dt>Status</dt>
          <dd>
            {eligibility ? (
              <Badge tone={eligibility.eligible ? 'success' : 'warning'}>{eligibility.eligible ? 'Ready to run' : 'Not ready'}</Badge>
            ) : (
              <span className="muted">
                <Spinner /> Loading
              </span>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>This call would spend</dt>
          <dd className="num">
            {eligibility && snapshot ? `${fmtNative(eligibility.budget)} ${native.symbol}` : '—'}
          </dd>
        </div>
        <div className="fact">
          <dt>Minimum to run</dt>
          <dd className="num">{snapshot ? `${fmtNative(snapshot.minBuyback)} ${native.symbol}` : '—'}</dd>
        </div>
        <div className="fact">
          <dt>Last buyback block</dt>
          <dd className="num">{snapshot ? (snapshot.lastBuybackBlock === 0n ? 'Never' : snapshot.lastBuybackBlock.toString()) : '—'}</dd>
        </div>
      </dl>

      {eligibility && !eligibility.eligible ? (
        <ul className="reasons" aria-label="Why the buyback cannot run now">
          {eligibility.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      <div className="actions">
        <button type="button" className="button button-primary button-large" onClick={onRun} disabled={!canRun} aria-describedby="buyback-help">
          {tx.busy ? <Spinner /> : null} Run buyback
        </button>
        <button type="button" className="button button-secondary" onClick={() => void refresh()}>
          Refresh state
        </button>
      </div>
      <p id="buyback-help" className="muted small">
        Eligibility is a snapshot of the latest block, not a guarantee. The buyback swaps at the pool's current price with no
        minimum output, so it can be sandwiched; the per-call cap and one-per-block rule bound the exposure.
      </p>

      {blockers.map((blocker) => (
        <StatusMessage key={blocker} tone="info">
          {blocker}
        </StatusMessage>
      ))}
      <TxStatus state={tx.state} explorer={network.explorer} />
    </section>
  );
}
