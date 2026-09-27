import { decodeAbiParameters, keccak256, parseEther, encodeAbiParameters, toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { buildPoolKey, evaluateEligibility, fetchBuybackEvents, poolIdOf, type AppContext, type HookSnapshot } from '../chain';
import { canonicalKeccak, parseManifest } from '../deployment';
import { formatAmount, formatCompact, parseAmountInput, priceFromSqrtX96 } from '../format';
import { ACTIONS_EXACT_IN_SINGLE, COMMAND_V4_SWAP, applySlippage, encodeExactInputSingle } from '../swap';
import { ensureChain, isUnknownChainError, isUserRejection, walletAddChainParams } from '../wallet';
import { HOOK, TOKEN_ADDRESS, defaultState, handleRpc, hookAbi, manifest, tokenAbi } from './rpcMock';

describe('deployment manifest', () => {
  it('accepts the committed manifest and binds ABIs by attested hash', () => {
    const parsed = parseManifest(manifest);
    expect(parsed.chainId).toBe(11155111);
    expect(parsed.contracts.map((c) => c.name)).toEqual(['LaunchToken', 'BuybackBurnHook']);
    expect(canonicalKeccak(tokenAbi)).toBe(parsed.contracts[0].abiHash);
    expect(canonicalKeccak(hookAbi)).toBe(parsed.contracts[1].abiHash);
    expect(parsed.network?.uniswapV4.universalRouter).toBe(manifest.network.uniswapV4.universalRouter);
  });

  it('rejects abiPath traversal, URLs and a network block on another chain', () => {
    const traversal = JSON.parse(JSON.stringify(manifest));
    traversal.contracts[0].abiPath = '../abi/LaunchToken.json';
    expect(() => parseManifest(traversal)).toThrow(/relative path/);
    const url = JSON.parse(JSON.stringify(manifest));
    url.contracts[0].abiPath = 'https://example.com/abi.json';
    expect(() => parseManifest(url)).toThrow(/relative path/);
    const wrongChain = JSON.parse(JSON.stringify(manifest));
    wrongChain.network.chainId = 1;
    expect(() => parseManifest(wrongChain)).toThrow(/chainId/);
  });

  it('canonical hash is independent of key order and whitespace', () => {
    const a = canonicalKeccak([{ type: 'function', name: 'x', inputs: [] }]);
    const b = canonicalKeccak([{ inputs: [], name: 'x', type: 'function' }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('pool key and id', () => {
  it('orders native ETH as currency0 and matches keccak(abi.encode(key))', () => {
    const key = buildPoolKey(TOKEN_ADDRESS, HOOK);
    expect(key.currency0).toBe('0x0000000000000000000000000000000000000000');
    expect(key.currency1).toBe(TOKEN_ADDRESS);
    expect(key.fee).toBe(3000);
    expect(key.tickSpacing).toBe(60);
    const manual = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
      ),
    );
    expect(poolIdOf(key)).toBe(manual);
    // Value observed on Sepolia for the deployed pool during worker validation.
    expect(poolIdOf(key)).toBe('0x7a41da995f418fe0afdee287f682e6012b5d0e7b7e01aa4851491f4371eacc91');
  });
});

describe('eligibility', () => {
  const base: HookSnapshot = {
    blockNumber: 100n,
    accruedEth: parseEther('0.002'),
    burnedTotal: 0n,
    lastBuybackBlock: 0n,
    minBuyback: parseEther('0.001'),
    maxBuyback: parseEther('0.05'),
    feeBps: 100n,
    deadBalance: 0n,
    sqrtPriceX96: null,
    liquidity: null,
    hookHasCode: true,
    tokenHasCode: true,
  };
  const fmt = (v: bigint) => formatAmount(v, 18, 6);

  it('is eligible above the minimum with no buyback this block', () => {
    const e = evaluateEligibility(base, 'ETH', fmt);
    expect(e.eligible).toBe(true);
    expect(e.budget).toBe(parseEther('0.002'));
  });

  it('caps the budget at MAX_BUYBACK', () => {
    expect(evaluateEligibility({ ...base, accruedEth: parseEther('1') }, 'ETH', fmt).budget).toBe(parseEther('0.05'));
  });

  it('explains the threshold and the same-block cooldown', () => {
    const low = evaluateEligibility({ ...base, accruedEth: parseEther('0.0005') }, 'ETH', fmt);
    expect(low.eligible).toBe(false);
    expect(low.reasons[0]).toMatch(/below the 0.001 ETH minimum/);
    const sameBlock = evaluateEligibility({ ...base, lastBuybackBlock: 100n }, 'ETH', fmt);
    expect(sameBlock.eligible).toBe(false);
    expect(sameBlock.reasons[0]).toMatch(/current block/);
  });
});

describe('swap encoding', () => {
  it('encodes V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL', () => {
    const key = buildPoolKey(TOKEN_ADDRESS, HOOK);
    const { commands, inputs } = encodeExactInputSingle(key, true, 1000n, 900n);
    expect(commands).toBe(COMMAND_V4_SWAP);
    expect(inputs).toHaveLength(1);
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]);
    expect(actions).toBe(ACTIONS_EXACT_IN_SINGLE);
    expect(params).toHaveLength(3);
    const [swap] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            {
              name: 'poolKey',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
              ],
            },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      params[0],
    );
    expect(swap.poolKey.hooks.toLowerCase()).toBe(HOOK.toLowerCase());
    expect(swap.zeroForOne).toBe(true);
    expect(swap.amountIn).toBe(1000n);
    expect(swap.amountOutMinimum).toBe(900n);
    expect(swap.hookData).toBe('0x');
    const [settleCurrency, settleAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]);
    expect(settleCurrency).toBe('0x0000000000000000000000000000000000000000');
    expect(settleAmount).toBe(1000n);
    const [takeCurrency, takeAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]);
    expect(takeCurrency.toLowerCase()).toBe(TOKEN_ADDRESS.toLowerCase());
    expect(takeAmount).toBe(900n);
  });

  it('flips currencies for a sell', () => {
    const key = buildPoolKey(TOKEN_ADDRESS, HOOK);
    const { inputs } = encodeExactInputSingle(key, false, 5n, 1n);
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]);
    const [settleCurrency] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]);
    expect(settleCurrency.toLowerCase()).toBe(TOKEN_ADDRESS.toLowerCase());
  });

  it('applies slippage in basis points, flooring', () => {
    expect(applySlippage(10_000n, 50)).toBe(9_950n);
    expect(applySlippage(999n, 100)).toBe(989n);
    expect(applySlippage(100n, 0)).toBe(100n);
  });
});

describe('formatting', () => {
  it('formats amounts with grouping and bounded fractions', () => {
    expect(formatAmount(parseEther('1234.5678901'), 18, 6)).toBe('1,234.56789');
    expect(formatAmount(0n, 18)).toBe('0');
    expect(formatAmount(1n, 18, 6)).toBe('<0.000001');
    expect(formatCompact(parseEther('12500000'), 18)).toBe('12.5M');
  });

  it('parses decimal input strictly', () => {
    expect(parseAmountInput('0.01', 18)).toBe(parseEther('0.01'));
    expect(parseAmountInput('1,000', 18)).toBe(parseEther('1000'));
    expect(parseAmountInput('abc', 18)).toBeNull();
    expect(parseAmountInput('', 18)).toBeNull();
    expect(parseAmountInput('1.' + '1'.repeat(19), 18)).toBeNull();
  });

  it('derives price from sqrtPriceX96', () => {
    expect(priceFromSqrtX96(79228162514264337593543950336n, 18, 18)).toBeCloseTo(1, 9);
  });
});

describe('wallet chain handling', () => {
  it('recognises unknown-chain and rejection errors', () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ message: 'Unrecognized chain ID "0xaa36a7"' })).toBe(true);
    expect(isUnknownChainError({ code: 4001 })).toBe(false);
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error('boom'))).toBe(false);
  });

  it('offers wallet_addEthereumChain after a failed switch, then switches again', async () => {
    const calls: { method: string; params?: unknown }[] = [];
    let known = false;
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        calls.push({ method, params });
        if (method === 'wallet_switchEthereumChain' && !known) throw { code: 4902, message: 'Unrecognized chain' };
        if (method === 'wallet_addEthereumChain') known = true;
        return null;
      },
    };
    const network = parseManifest(manifest).network!;
    await ensureChain(provider, network);
    expect(calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(calls[1].params).toEqual([walletAddChainParams(network)]);
    expect(walletAddChainParams(network)).toEqual({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: manifest.network.rpcUrls,
      nativeCurrency: manifest.network.nativeCurrency,
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    });
  });

  it('propagates other switch errors without adding the chain', async () => {
    const provider = {
      async request({ method }: { method: string }) {
        if (method === 'wallet_switchEthereumChain') throw { code: 4001, message: 'User rejected' };
        throw new Error('should not be called');
      },
    };
    await expect(ensureChain(provider, parseManifest(manifest).network!)).rejects.toMatchObject({ code: 4001 });
  });
});

describe('event scanning', () => {
  it('walks back in bounded windows, shrinks on range errors and keeps the newest 20', async () => {
    const state = defaultState({
      blockNumber: 11_850_000n,
      buybackLogs: Array.from({ length: 25 }, (_, i) => ({ blockNumber: 11_800_000n + BigInt(i) * 1_000n, ethSpent: BigInt(i + 1), tokensBurned: BigInt(i + 1) * 10n })),
    });
    const getLogs = vi.fn(async (args: { fromBlock: bigint; toBlock: bigint; address: string }) => {
      const raw = handleRpc(state, 'eth_getLogs', [{ fromBlock: toHex(args.fromBlock), toBlock: toHex(args.toBlock), address: args.address, topics: [] }]) as {
        blockNumber: string;
        transactionHash: string;
        logIndex: string;
        data: `0x${string}`;
      }[];
      return raw.map((log) => {
        const [ethSpent, tokensBurned] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], log.data);
        return { blockNumber: BigInt(log.blockNumber), transactionHash: log.transactionHash, logIndex: Number(log.logIndex), args: { ethSpent, tokensBurned } };
      });
    });
    const ctx = { client: { getLogs }, deployment: { hook: { address: HOOK } }, poolId: '0x00' } as unknown as AppContext;
    const events = await fetchBuybackEvents(ctx, 11_791_306n, 11_850_000n, 20);
    expect(events).toHaveLength(20);
    expect(events[0].blockNumber).toBe(11_824_000n);
    expect(events[19].blockNumber).toBe(11_805_000n);
    expect(events[0].ethSpent).toBe(25n);
    // Every request stayed within the public-RPC window.
    for (const req of state.logRequests.slice(1)) expect(req.to - req.from).toBeLessThanOrEqual(10_000n);
  });
});
