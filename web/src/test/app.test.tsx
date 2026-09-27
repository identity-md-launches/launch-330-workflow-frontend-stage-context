/**
 * Interaction tests for the exported page's primary controls, with an
 * in-memory JSON-RPC node and a mock injected wallet. No real chain, funds
 * or wallet extension are used.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseEther } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { ACCOUNT, HOOK, UNI, createMockWallet, defaultState, installFetch, manifest, type NodeState } from './rpcMock';

let state: NodeState;

beforeEach(() => {
  state = defaultState();
  installFetch(state);
  delete (window as { ethereum?: unknown }).ethereum;
});

afterEach(() => {
  cleanup();
});

function attachWallet(options: Parameters<typeof createMockWallet>[1] = {}) {
  const wallet = createMockWallet(state, options);
  (window as unknown as { ethereum: unknown }).ethereum = wallet;
  return wallet;
}

async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
  await screen.findByText('0x1111…1111');
}

describe('reads without a wallet', () => {
  it('loads the runtime manifest, shows live state and an empty history', async () => {
    state.burnedTotal = parseEther('12500000');
    state.accruedEth = parseEther('0.0004');
    state.deadBalance = parseEther('12500000');
    render(<App />);
    expect(await screen.findByText('12.5M')).toBeTruthy();
    expect(await screen.findByText('0.0004')).toBeTruthy();
    expect((await screen.findAllByText('Not yet')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/below the 0.001 ETH minimum/)).length).toBeGreaterThan(0);
    expect(await screen.findByText('No buybacks yet')).toBeTruthy();
    expect(await screen.findByText('No browser wallet detected')).toBeTruthy();
    // Both contract addresses come from the manifest, with explorer links.
    const hookLink = screen.getByTitle(HOOK);
    expect(hookLink.getAttribute('href')).toBe(`${manifest.network.explorer}/address/${HOOK}`);
    // Transaction control is disabled while disconnected.
    expect((screen.getByRole('button', { name: 'Run buyback' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText(/Connect a wallet to run a buyback/)).toBeTruthy();
  });

  it('lists the newest 20 buyback events from logs, newest first', async () => {
    state.buybackLogs = Array.from({ length: 23 }, (_, i) => ({
      blockNumber: 11_795_000n + BigInt(i),
      ethSpent: parseEther('0.01') * BigInt(i + 1),
      tokensBurned: parseEther('100') * BigInt(i + 1),
    }));
    render(<App />);
    const table = await screen.findByRole('table', { name: 'Recent buybacks, newest first' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('11795022')).toBeTruthy();
    expect(within(rows[0]).getByText('0.23')).toBeTruthy();
    expect(within(rows[0]).getByText('2,300')).toBeTruthy();
    expect(within(rows[19]).getByText('11795003')).toBeTruthy();
  });

  it('shows a recoverable error when the manifest cannot be loaded', async () => {
    globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Unable to load the deployment configuration'));
  });
});

describe('wallet connection and network', () => {
  it('connects, detects the wrong chain, adds the chain when unknown and switches', async () => {
    const user = userEvent.setup();
    const wallet = attachWallet({ chainId: 1, unknownChainOnce: true });
    render(<App />);
    await connect(user);
    const switchButton = await screen.findByRole('button', { name: 'Switch to Sepolia' });
    expect((await screen.findAllByText(/Your wallet is on another network/)).length).toBeGreaterThan(0);
    await user.click(switchButton);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Switch to Sepolia' })).toBeNull());
    expect(wallet.addChainCalls).toEqual([
      {
        chainId: '0xaa36a7',
        chainName: 'Sepolia',
        rpcUrls: manifest.network.rpcUrls,
        nativeCurrency: manifest.network.nativeCurrency,
        blockExplorerUrls: [manifest.network.explorer],
      },
    ]);
    expect(wallet.chainId).toBe(11155111);
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('reports a rejected connection without crashing', async () => {
    const user = userEvent.setup();
    const wallet = attachWallet();
    const original = wallet.request.bind(wallet);
    wallet.request = async (args) => {
      if (args.method === 'eth_requestAccounts') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      return original(args);
    };
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    expect(await screen.findByText('Connection request was rejected in the wallet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
  });
});

describe('buyback control', () => {
  it('is enabled only when eligible, simulates, signs, waits and refreshes', async () => {
    const user = userEvent.setup();
    state.accruedEth = parseEther('0.02');
    // The transaction changes on-chain state; the page must re-read it after confirmation.
    attachWallet({
      onSend: () => {
        state.accruedEth = 0n;
        state.burnedTotal = parseEther('19000');
        state.lastBuybackBlock = state.blockNumber;
      },
    });
    render(<App />);
    await connect(user);
    expect((await screen.findAllByText('Can run now')).length).toBeGreaterThan(0);
    expect(await screen.findByText('0.02 ETH')).toBeTruthy();
    const run = await screen.findByRole('button', { name: 'Run buyback' });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await user.click(run);
    expect(await screen.findByText('Transaction confirmed.')).toBeTruthy();
    const simulated = state.calls.filter((c) => c.functionName === 'buyback');
    expect(simulated.length).toBeGreaterThan(0);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].to.toLowerCase()).toBe(HOOK.toLowerCase());
    expect(state.transactions[0].functionName).toBe('buyback');
    const key = state.transactions[0].args[0] as { hooks: string; currency0: string };
    expect(key.hooks.toLowerCase()).toBe(HOOK.toLowerCase());
    expect(key.currency0).toBe('0x0000000000000000000000000000000000000000');
    expect(screen.getByRole('link', { name: /View transaction/ }).getAttribute('href')).toBe(`${manifest.network.explorer}/tx/${state.transactions[0].hash}`);
    expect(await screen.findByText('19,000')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Run buyback' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('shows the revert reason from simulation and sends nothing', async () => {
    const user = userEvent.setup();
    state.accruedEth = parseEther('0.02');
    state.buybackRevert = 'AlreadyBoughtBack';
    attachWallet();
    render(<App />);
    await connect(user);
    const run = await screen.findByRole('button', { name: 'Run buyback' });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await user.click(run);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Simulation failed/);
    expect(alert.textContent).toMatch(/AlreadyBoughtBack\(\)/);
    expect(state.transactions).toHaveLength(0);
  });

  it('reports a wallet rejection as not sent', async () => {
    const user = userEvent.setup();
    state.accruedEth = parseEther('0.02');
    attachWallet({ rejectSend: true });
    render(<App />);
    await connect(user);
    const run = await screen.findByRole('button', { name: 'Run buyback' });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await user.click(run);
    expect(await screen.findByText(/rejected in the wallet. Nothing was sent/)).toBeTruthy();
    expect(state.transactions).toHaveLength(0);
  });

  it('reports an on-chain revert after sending', async () => {
    const user = userEvent.setup();
    state.accruedEth = parseEther('0.02');
    state.receiptStatus = '0x0';
    attachWallet();
    render(<App />);
    await connect(user);
    const run = await screen.findByRole('button', { name: 'Run buyback' });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await user.click(run);
    expect(await screen.findByText(/Transaction reverted on-chain/)).toBeTruthy();
  });
});

describe('swap control', () => {
  it('quotes through the manifest quoter and buys through the universal router with ETH value', async () => {
    const user = userEvent.setup();
    attachWallet();
    render(<App />);
    await connect(user);
    const amount = await screen.findByLabelText('Amount in ETH');
    await user.type(amount, '0.01');
    expect(await screen.findByText('900 EMBR')).toBeTruthy();
    expect(await screen.findByText('895.5 EMBR')).toBeTruthy();
    const quoteCalls = state.calls.filter((c) => c.functionName === 'quoteExactInputSingle');
    expect(quoteCalls.length).toBeGreaterThan(0);
    expect(quoteCalls[0].to.toLowerCase()).toBe(UNI.quoter.toLowerCase());
    const buy = screen.getByRole('button', { name: 'Buy EMBR' });
    await waitFor(() => expect((buy as HTMLButtonElement).disabled).toBe(false));
    await user.click(buy);
    expect(await screen.findByText('Transaction confirmed.')).toBeTruthy();
    const execSim = state.calls.find((c) => c.functionName === 'execute');
    expect(execSim?.to.toLowerCase()).toBe(UNI.universalRouter.toLowerCase());
    expect(execSim?.value).toBe(parseEther('0.01'));
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].to.toLowerCase()).toBe(UNI.universalRouter.toLowerCase());
    expect(state.transactions[0].value).toBe(parseEther('0.01'));
    const [commands] = state.transactions[0].args as [string];
    expect(commands).toBe('0x10');
  });

  it('shows the router revert reason before asking for a signature', async () => {
    const user = userEvent.setup();
    state.executeRevert = 'V4TooLittleReceived';
    attachWallet();
    render(<App />);
    await connect(user);
    await user.type(await screen.findByLabelText('Amount in ETH'), '0.01');
    const buy = screen.getByRole('button', { name: 'Buy EMBR' });
    await waitFor(() => expect((buy as HTMLButtonElement).disabled).toBe(false));
    await user.click(buy);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/V4TooLittleReceived/);
    expect(state.transactions).toHaveLength(0);
  });

  it('walks a sell through ERC-20 approval, Permit2 allowance and the swap as separate steps', async () => {
    const user = userEvent.setup();
    state.quoteOut = parseEther('0.005');
    attachWallet({
      onSend: (tx) => {
        if (tx.to.toLowerCase() === UNI.permit2.toLowerCase()) {
          state.permit2Amount = parseEther('1000');
          state.permit2Expiration = BigInt(Math.floor(Date.now() / 1000) + 3600);
        } else if (tx.to.toLowerCase() !== UNI.universalRouter.toLowerCase()) {
          state.erc20Allowance = parseEther('1000');
        }
        state.blockNumber += 1n;
      },
    });
    render(<App />);
    await connect(user);
    await user.click(await screen.findByLabelText('Sell EMBR for ETH'));
    await user.type(await screen.findByLabelText('Amount in EMBR'), '1000');
    expect(await screen.findByText('0.005 ETH')).toBeTruthy();
    const approve = await screen.findByRole('button', { name: 'Approve EMBR for Permit2' });
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Sell EMBR' })).toBeNull();
    await user.click(approve);
    const permit = await screen.findByRole('button', { name: 'Allow the router on Permit2' });
    expect(state.transactions[0].functionName).toBe('approve');
    expect((state.transactions[0].args[0] as string).toLowerCase()).toBe(UNI.permit2.toLowerCase());
    await waitFor(() => expect((permit as HTMLButtonElement).disabled).toBe(false));
    await user.click(permit);
    const sell = await screen.findByRole('button', { name: 'Sell EMBR' });
    expect(state.transactions[1].to.toLowerCase()).toBe(UNI.permit2.toLowerCase());
    expect((state.transactions[1].args[1] as string).toLowerCase()).toBe(UNI.universalRouter.toLowerCase());
    await waitFor(() => expect((sell as HTMLButtonElement).disabled).toBe(false));
    await user.click(sell);
    await waitFor(() => expect(state.transactions).toHaveLength(3));
    expect(state.transactions[2].to.toLowerCase()).toBe(UNI.universalRouter.toLowerCase());
    expect(state.transactions[2].value).toBe(0n);
    // One confirmation per step: ERC-20 approval, Permit2 allowance, swap.
    await waitFor(() => expect(screen.getAllByText('Transaction confirmed.')).toHaveLength(3));
  });

  it('rejects malformed amounts and amounts above the balance', async () => {
    const user = userEvent.setup();
    attachWallet();
    render(<App />);
    await connect(user);
    const amount = await screen.findByLabelText('Amount in ETH');
    await user.type(amount, 'abc');
    expect(await screen.findByText(/Enter a positive number/)).toBeTruthy();
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    await user.clear(amount);
    await user.type(amount, '5');
    expect(await screen.findByText(/exceeds your ETH balance/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Buy EMBR' }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.transactions).toHaveLength(0);
    expect(ACCOUNT).toBeTruthy();
  });
});
