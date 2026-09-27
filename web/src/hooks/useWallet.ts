import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, Chain, WalletClient } from 'viem';
import type { NetworkBlock } from '../deployment';
import { describeError } from '../format';
import {
  discoverWallets,
  ensureChain,
  isUserRejection,
  makeWalletClient,
  readChainId,
  requestAccounts,
  type Eip1193Provider,
  type WalletOption,
} from '../wallet';

export type WalletStatus = 'discovering' | 'no-wallet' | 'disconnected' | 'connecting' | 'connected';

export interface WalletState {
  status: WalletStatus;
  options: WalletOption[];
  selected: WalletOption | null;
  account: Address | null;
  chainId: number | null;
  error: string | null;
  switching: boolean;
}

export interface WalletApi extends WalletState {
  /** True when connected and on the deployment chain. */
  onTargetChain: boolean;
  walletClient: WalletClient | null;
  provider: Eip1193Provider | null;
  connect: (optionId?: string) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  rediscover: () => Promise<void>;
}

export function useWallet(network: NetworkBlock | null, chain: Chain | null): WalletApi {
  const [state, setState] = useState<WalletState>({
    status: 'discovering',
    options: [],
    selected: null,
    account: null,
    chainId: null,
    error: null,
    switching: false,
  });
  const providerRef = useRef<Eip1193Provider | null>(null);

  const rediscover = useCallback(async () => {
    setState((s) => ({ ...s, status: s.status === 'connected' ? s.status : 'discovering' }));
    const options = await discoverWallets();
    setState((s) => ({
      ...s,
      options,
      status: s.status === 'connected' ? 'connected' : options.length === 0 ? 'no-wallet' : 'disconnected',
    }));
  }, []);

  useEffect(() => {
    void rediscover();
  }, [rediscover]);

  const detach = useCallback(() => {
    const provider = providerRef.current;
    if (provider?.removeListener) {
      provider.removeListener('accountsChanged', onAccountsChanged);
      provider.removeListener('chainChanged', onChainChanged);
      provider.removeListener('disconnect', onDisconnect);
    }
    providerRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onAccountsChanged(...args: unknown[]) {
    const accounts = (args[0] as string[]) ?? [];
    if (accounts.length === 0) {
      detach();
      setState((s) => ({ ...s, status: 'disconnected', account: null, chainId: null, selected: null }));
      return;
    }
    setState((s) => ({ ...s, account: accounts[0] as Address }));
  }

  function onChainChanged(...args: unknown[]) {
    const hex = args[0] as string;
    setState((s) => ({ ...s, chainId: Number.parseInt(hex, 16) }));
  }

  function onDisconnect() {
    detach();
    setState((s) => ({ ...s, status: 'disconnected', account: null, chainId: null, selected: null }));
  }

  const connect = useCallback(
    async (optionId?: string) => {
      const option = state.options.find((o) => o.id === optionId) ?? state.options[0];
      if (!option) {
        setState((s) => ({ ...s, status: 'no-wallet', error: 'No browser wallet was detected.' }));
        return;
      }
      setState((s) => ({ ...s, status: 'connecting', error: null, selected: option }));
      try {
        const accounts = await requestAccounts(option.provider);
        if (accounts.length === 0) throw new Error('The wallet returned no accounts.');
        const chainId = await readChainId(option.provider);
        detach();
        providerRef.current = option.provider;
        option.provider.on?.('accountsChanged', onAccountsChanged);
        option.provider.on?.('chainChanged', onChainChanged);
        option.provider.on?.('disconnect', onDisconnect);
        setState((s) => ({ ...s, status: 'connected', account: accounts[0], chainId, error: null }));
      } catch (error) {
        setState((s) => ({
          ...s,
          status: 'disconnected',
          selected: null,
          error: isUserRejection(error) ? 'Connection request was rejected in the wallet.' : describeError(error),
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.options, detach],
  );

  const disconnect = useCallback(() => {
    detach();
    setState((s) => ({ ...s, status: s.options.length ? 'disconnected' : 'no-wallet', account: null, chainId: null, selected: null, error: null }));
  }, [detach]);

  const switchChain = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !network) return;
    setState((s) => ({ ...s, switching: true, error: null }));
    try {
      await ensureChain(provider, network);
      const chainId = await readChainId(provider);
      setState((s) => ({ ...s, switching: false, chainId }));
    } catch (error) {
      setState((s) => ({
        ...s,
        switching: false,
        error: isUserRejection(error)
          ? `Network switch was rejected in the wallet. Switch to ${network.name} to continue.`
          : `Unable to switch network: ${describeError(error)}`,
      }));
    }
  }, [network]);

  const onTargetChain = state.status === 'connected' && network !== null && state.chainId === network.chainId;

  const walletClient = useMemo(() => {
    if (!onTargetChain || !chain || !state.account || !providerRef.current) return null;
    return makeWalletClient(providerRef.current, chain, state.account);
  }, [onTargetChain, chain, state.account]);

  return {
    ...state,
    onTargetChain,
    walletClient,
    provider: providerRef.current,
    connect,
    disconnect,
    switchChain,
    rediscover,
  };
}
