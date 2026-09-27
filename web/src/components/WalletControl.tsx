import type { NetworkBlock } from '../deployment';
import { explorerAddress, shortAddress } from '../format';
import type { WalletApi } from '../hooks/useWallet';
import { Spinner, StatusMessage } from './Status';

/**
 * Header wallet control: detects wallets, connects, shows the account and
 * offers a single "Switch to <network>" action when the chain is wrong.
 */
export function WalletControl({ wallet, network }: { wallet: WalletApi; network: NetworkBlock | null }) {
  const networkName = network?.name ?? 'the deployment network';

  if (wallet.status === 'discovering') {
    return (
      <div className="wallet">
        <span className="wallet-note">
          <Spinner /> Looking for wallets…
        </span>
      </div>
    );
  }

  if (wallet.status === 'no-wallet') {
    return (
      <div className="wallet">
        <span className="wallet-note">No browser wallet detected</span>
        <button type="button" className="button button-secondary" onClick={() => void wallet.rediscover()}>
          Check again
        </button>
      </div>
    );
  }

  if (wallet.status === 'connected' && wallet.account) {
    const wrongChain = network !== null && wallet.chainId !== network.chainId;
    return (
      <div className="wallet">
        {wrongChain ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => void wallet.switchChain()}
            disabled={wallet.switching}
          >
            {wallet.switching ? <Spinner /> : null} Switch to {networkName}
          </button>
        ) : null}
        <span className="wallet-account" translate="no">
          <span className="wallet-dot" aria-hidden="true" />
          {network ? (
            <a href={explorerAddress(network.explorer, wallet.account)} target="_blank" rel="noreferrer" title={wallet.account}>
              {shortAddress(wallet.account)}
              <span className="sr-only"> (opens the explorer in a new tab)</span>
            </a>
          ) : (
            <span title={wallet.account}>{shortAddress(wallet.account)}</span>
          )}
        </span>
        <button type="button" className="button button-secondary" onClick={wallet.disconnect}>
          Disconnect
        </button>
        {wallet.error ? <StatusMessage tone="error">{wallet.error}</StatusMessage> : null}
      </div>
    );
  }

  const connecting = wallet.status === 'connecting';
  return (
    <div className="wallet">
      {wallet.options.length > 1 ? (
        <label className="wallet-select">
          <span className="sr-only">Wallet</span>
          <select id="wallet-choice" defaultValue={wallet.options[0]?.id} aria-label="Wallet" disabled={connecting}>
            {wallet.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        className="button button-primary"
        disabled={connecting}
        onClick={() => {
          const select = document.getElementById('wallet-choice') as HTMLSelectElement | null;
          void wallet.connect(select?.value ?? wallet.options[0]?.id);
        }}
      >
        {connecting ? <Spinner /> : null} Connect wallet
      </button>
      {wallet.error ? <StatusMessage tone="error">{wallet.error}</StatusMessage> : null}
    </div>
  );
}
