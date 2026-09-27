import { encodeAbiParameters, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { POOL_KEY_ABI_TYPE, type PoolKey } from './chain';

export const QUOTER_ABI = parseAbi([
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

export const PERMIT2_ABI = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

/** Universal Router command byte for a v4 swap. */
export const COMMAND_V4_SWAP = '0x10' as const;
/** v4 router actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL. */
export const ACTIONS_EXACT_IN_SINGLE = '0x060c0f' as const;

export const NATIVE = '0x0000000000000000000000000000000000000000' as const;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT48 = (1n << 48n) - 1n;

export interface SwapDirection {
  /** true = currency0 in (ETH → EMBR), false = currency1 in (EMBR → ETH). */
  zeroForOne: boolean;
  inputCurrency: Address;
  outputCurrency: Address;
}

export function directionFor(key: PoolKey, zeroForOne: boolean): SwapDirection {
  return zeroForOne
    ? { zeroForOne, inputCurrency: key.currency0, outputCurrency: key.currency1 }
    : { zeroForOne, inputCurrency: key.currency1, outputCurrency: key.currency0 };
}

/** Applies slippage in basis points to a quoted output amount (floors). */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** Quotes an exact-input single-hop swap through the manifest quoter, never as a transaction. */
export async function quoteExactInputSingle(
  client: PublicClient,
  quoter: Address,
  key: PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  const { result } = await client.simulateContract({
    address: quoter,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
  });
  return { amountOut: result[0], gasEstimate: result[1] };
}

/**
 * Encodes `execute(commands, inputs, deadline)` arguments for one exact-input
 * v4 swap: SWAP_EXACT_IN_SINGLE, SETTLE_ALL(input, amountIn), TAKE_ALL(output, minOut).
 */
export function encodeExactInputSingle(
  key: PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
  amountOutMinimum: bigint,
): { commands: Hex; inputs: Hex[] } {
  const dir = directionFor(key, zeroForOne);
  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', ...POOL_KEY_ABI_TYPE },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum, hookData: '0x' }],
  );
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [dir.inputCurrency, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [dir.outputCurrency, amountOutMinimum]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [ACTIONS_EXACT_IN_SINGLE, [swapParams, settle, take]]);
  return { commands: COMMAND_V4_SWAP, inputs: [input] };
}

export function swapDeadline(nowSeconds: number, ttlSeconds: number): bigint {
  return BigInt(Math.floor(nowSeconds) + ttlSeconds);
}
