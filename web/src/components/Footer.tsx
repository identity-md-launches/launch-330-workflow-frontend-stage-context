import type { AppContext } from '../chain';
import { explorerAddress, shortAddress } from '../format';

/** Contract addresses with explorer links and the deployment identifiers. */
export function Footer({ ctx }: { ctx: AppContext | null }) {
  if (!ctx) return null;
  const { manifest } = ctx.deployment;
  const { network } = ctx;
  const rows: { label: string; address: `0x${string}` }[] = [
    ...manifest.contracts.map((c) => ({ label: c.name, address: c.address })),
    { label: 'Uniswap v4 PoolManager', address: network.uniswapV4.poolManager },
    { label: 'Universal Router', address: network.uniswapV4.universalRouter },
    { label: 'V4 Quoter', address: network.uniswapV4.quoter },
    { label: 'Permit2', address: network.uniswapV4.permit2 },
  ];
  return (
    <footer className="footer" aria-labelledby="footer-heading">
      <h2 id="footer-heading">Contracts and deployment</h2>
      <dl className="contract-list">
        {rows.map((row) => (
          <div className="contract-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd translate="no">
              <a href={explorerAddress(network.explorer, row.address)} target="_blank" rel="noreferrer" title={row.address}>
                {shortAddress(row.address)}
                <span className="sr-only"> (opens the explorer in a new tab)</span>
              </a>
            </dd>
          </div>
        ))}
        <div className="contract-row">
          <dt>Pool ID</dt>
          <dd translate="no" title={ctx.poolId}>
            {shortAddress(ctx.poolId)}
          </dd>
        </div>
        <div className="contract-row">
          <dt>Network</dt>
          <dd>
            {network.name} (chain {network.chainId}){network.testnet ? ', testnet' : ''}
          </dd>
        </div>
        <div className="contract-row">
          <dt>Source commit</dt>
          <dd translate="no" title={manifest.sourceCommit}>
            {manifest.sourceCommit.slice(0, 12)}
          </dd>
        </div>
        <div className="contract-row">
          <dt>Launch ID</dt>
          <dd translate="no">{manifest.launchId}</dd>
        </div>
      </dl>
      <p className="muted footer-note">
        Reads use the public RPC endpoints listed in the deployment manifest. Transactions are signed in your wallet. This site has no backend and stores nothing.
      </p>
    </footer>
  );
}
