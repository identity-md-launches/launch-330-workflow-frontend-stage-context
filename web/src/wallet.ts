import { createWalletClient, custom, numberToHex, type Address, type Chain, type WalletClient } from 'viem';
import type { NetworkBlock } from './deployment';

/** Minimal EIP-1193 provider surface used by the app. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean; providers?: Eip1193Provider[] };
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<Eip6963Detail>;
  }
}

/**
 * Discovers browser wallets: EIP-6963 announcements first, then the legacy
 * `window.ethereum` object if nothing announced. Resolves after a short wait
 * so wallets that inject late still appear.
 */
export function discoverWallets(waitMs = 300): Promise<WalletOption[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve([]);
      return;
    }
    const found = new Map<string, WalletOption>();
    const onAnnounce = (event: CustomEvent<Eip6963Detail>) => {
      const { info, provider } = event.detail;
      found.set(info.uuid, { id: info.uuid, name: info.name, icon: info.icon, provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      if (found.size === 0 && window.ethereum) {
        const legacy = window.ethereum;
        found.set('injected', {
          id: 'injected',
          name: legacy.isMetaMask ? 'MetaMask' : 'Browser wallet',
          provider: legacy,
        });
      }
      resolve([...found.values()]);
    }, waitMs);
  });
}

export function walletAddChainParams(network: NetworkBlock) {
  return {
    chainId: numberToHex(network.chainId),
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}

export interface ProviderRpcError {
  code?: number;
  message?: string;
  data?: { originalError?: { code?: number }; code?: number };
}

/** True when the wallet reports it does not know the requested chain. */
export function isUnknownChainError(error: unknown): boolean {
  const e = error as ProviderRpcError;
  const codes = [e?.code, e?.data?.code, e?.data?.originalError?.code];
  if (codes.includes(4902)) return true;
  const message = String(e?.message ?? '').toLowerCase();
  return /unrecognized chain|unknown chain|not added|chain.*(not|un)supported|4902/.test(message);
}

/** Wallet rejected the request (EIP-1193 code 4001). */
export function isUserRejection(error: unknown): boolean {
  const e = error as ProviderRpcError & { cause?: ProviderRpcError; name?: string };
  const codes = [e?.code, e?.cause?.code];
  if (codes.includes(4001)) return true;
  if (e?.name === 'UserRejectedRequestError') return true;
  return /user rejected|user denied|rejected the request/i.test(String(e?.message ?? ''));
}

/**
 * Switches the wallet to the network. When the wallet does not know the
 * chain (4902 or equivalent), offers `wallet_addEthereumChain` with the
 * manifest network parameters and switches again.
 */
export async function ensureChain(provider: Eip1193Provider, network: NetworkBlock): Promise<void> {
  const chainId = numberToHex(network.chainId);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    return;
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [walletAddChainParams(network)] });
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
}

export async function requestAccounts(provider: Eip1193Provider): Promise<Address[]> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts.map((a) => a as Address);
}

export async function readChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

export function makeWalletClient(provider: Eip1193Provider, chain: Chain, account: Address): WalletClient {
  return createWalletClient({ chain, account, transport: custom(provider) });
}
