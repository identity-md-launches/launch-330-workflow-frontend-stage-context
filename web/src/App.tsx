import { evaluateEligibility } from './chain';
import { TOKEN } from './config';
import { BuybackCard } from './components/BuybackCard';
import { BuybackTable } from './components/BuybackTable';
import { Footer } from './components/Footer';
import { Badge, Spinner, StatusMessage } from './components/Status';
import { SwapCard } from './components/SwapCard';
import { WalletControl } from './components/WalletControl';
import { formatAmount, formatCompact, formatPrice, priceFromSqrtX96 } from './format';
import { useBuybacks } from './hooks/useBuybacks';
import { useDeployment } from './hooks/useDeployment';
import { useHookState } from './hooks/useHookState';
import { useWallet } from './hooks/useWallet';

function FlameIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.12" />
      <path d="M16 5c2 5 8 7 8 14a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 5 3 5 1-3-1-7 1-11z" fill="currentColor" />
    </svg>
  );
}

export function App() {
  const deployment = useDeployment();
  const ctx = deployment.status === 'ready' ? deployment.ctx : null;
  const wallet = useWallet(ctx?.network ?? null, ctx?.chain ?? null);
  const hookState = useHookState(ctx);
  const buybacks = useBuybacks(ctx, hookState.snapshot?.blockNumber ?? null);

  const network = ctx?.network ?? null;
  const native = network?.nativeCurrency ?? { symbol: 'ETH', decimals: 18, name: 'Ether' };
  const snapshot = hookState.snapshot;
  const eligibility = snapshot ? evaluateEligibility(snapshot, native.symbol, (v) => formatAmount(v, native.decimals, 6)) : null;
  const price = snapshot?.sqrtPriceX96 ? priceFromSqrtX96(snapshot.sqrtPriceX96, native.decimals, TOKEN.decimals) : null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-row">
          <div className="brand">
            <FlameIcon />
            <div>
              <p className="brand-title">
                {TOKEN.name} buyback and burn
              </p>
              <p className="brand-subtitle">
                {TOKEN.symbol} · {network ? `${network.name}${network.testnet ? ' testnet' : ''}` : 'Loading network…'}
              </p>
            </div>
          </div>
          <WalletControl wallet={wallet} network={network} />
        </div>
      </header>

      <main id="main" className="container" tabIndex={-1}>
        <h1 className="page-title">Every trade burns {TOKEN.symbol}</h1>
        <p className="lede">
          The hook takes a {snapshot ? Number(snapshot.feeBps) / 100 : 1}% fee on each swap in the {TOKEN.symbol}/{native.symbol} pool.
          Fees paid in {TOKEN.symbol} are burned at once; fees paid in {native.symbol} wait here until anyone runs a buyback, which buys{' '}
          {TOKEN.symbol} and burns it too.
        </p>

        {deployment.status === 'loading' ? (
          <p className="muted" role="status">
            <Spinner /> Loading deployment configuration…
          </p>
        ) : null}
        {deployment.status === 'error' ? (
          <StatusMessage tone="error">
            Unable to load the deployment configuration: {deployment.message}. Reload the page; if this keeps happening the export is incomplete.
          </StatusMessage>
        ) : null}

        {ctx ? (
          <>
            <section className="stats" aria-labelledby="overview-heading">
              <h2 id="overview-heading" className="sr-only">
                Overview
              </h2>
              <div className="stat">
                <p className="stat-label">Burned total</p>
                <p className="stat-value num" title={snapshot ? `${formatAmount(snapshot.burnedTotal, TOKEN.decimals, 18)} ${TOKEN.symbol}` : undefined}>
                  {snapshot ? formatCompact(snapshot.burnedTotal, TOKEN.decimals) : '—'} <span className="stat-unit">{TOKEN.symbol}</span>
                </p>
                <p className="stat-note">
                  Counted by the hook. Burn address holds {snapshot ? formatCompact(snapshot.deadBalance, TOKEN.decimals) : '—'} {TOKEN.symbol}.
                </p>
              </div>
              <div className="stat">
                <p className="stat-label">Pending buyback {native.symbol}</p>
                <p className="stat-value num">
                  {snapshot ? formatAmount(snapshot.accruedEth, native.decimals, 6) : '—'} <span className="stat-unit">{native.symbol}</span>
                </p>
                <p className="stat-note">Held as ERC-6909 claims until a buyback spends them.</p>
              </div>
              <div className="stat">
                <p className="stat-label">Buyback</p>
                <p className="stat-value">
                  {eligibility ? <Badge tone={eligibility.eligible ? 'success' : 'warning'}>{eligibility.eligible ? 'Can run now' : 'Not yet'}</Badge> : '—'}
                </p>
                <p className="stat-note">
                  {eligibility ? (eligibility.eligible ? 'Anyone can trigger it below.' : eligibility.reasons[0]) : 'Checking…'}
                </p>
              </div>
              <div className="stat">
                <p className="stat-label">Pool price</p>
                <p className="stat-value num">
                  {price !== null ? formatPrice(price) : '—'} <span className="stat-unit">{TOKEN.symbol} per {native.symbol}</span>
                </p>
                <p className="stat-note">
                  {snapshot?.liquidity === 0n ? 'No liquidity in range at this price.' : 'Spot price from the pool state.'}
                </p>
              </div>
            </section>

            <p className="muted small updated" role="status">
              {hookState.error ? (
                hookState.error
              ) : snapshot ? (
                <>
                  Block {snapshot.blockNumber.toString()} · updated {hookState.updatedAt ? new Date(hookState.updatedAt).toLocaleTimeString() : ''} · refreshes every 15 seconds
                </>
              ) : (
                <>
                  <Spinner /> Reading contract state…
                </>
              )}
            </p>

            <div className="grid">
              <BuybackCard ctx={ctx} snapshot={snapshot} wallet={wallet} refresh={hookState.refresh} />
              <SwapCard ctx={ctx} snapshot={snapshot} wallet={wallet} refresh={hookState.refresh} refreshKey={hookState.updatedAt} />
            </div>

            <BuybackTable buybacks={buybacks} explorer={ctx.network.explorer} nativeSymbol={native.symbol} nativeDecimals={native.decimals} />
          </>
        ) : null}
      </main>

      <div className="container">
        <Footer ctx={ctx} />
      </div>
    </>
  );
}
