import {
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  fallback,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { BUYBACK_EVENT_LIMIT, LOG_CHUNK_SIZE, POOL } from './config';
import type { LoadedDeployment, NetworkBlock } from './deployment';

/** Uniswap v4 PoolKey, field order fixed by the protocol. */
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export const POOL_KEY_ABI_TYPE = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const;

/** Builds the launch pool key: native ETH as currency0, EMBR as currency1. */
export function buildPoolKey(token: Address, hook: Address): PoolKey {
  const paired = POOL.pairedCurrency.toLowerCase();
  const tokenLower = token.toLowerCase();
  const isNative = paired === '0x0000000000000000000000000000000000000000';
  const [currency0, currency1] = isNative || paired < tokenLower ? [POOL.pairedCurrency, token] : [token, POOL.pairedCurrency];
  return { currency0: currency0 as Address, currency1: currency1 as Address, fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: hook };
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(encodeAbiParameters([POOL_KEY_ABI_TYPE], [key]));
}

/** Builds a viem chain from the manifest's network block. */
export function chainFromNetwork(network: NetworkBlock): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
  });
}

/** Public read client using the manifest's RPC list with fallback ordering. */
export function createReadClient(network: NetworkBlock): PublicClient {
  const chain = chainFromNetwork(network);
  return createPublicClient({
    chain,
    transport: fallback(
      network.rpcUrls.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
  });
}

export const BUYBACK_EVENT = parseAbiItem(
  'event Buyback(bytes32 indexed poolId, uint256 ethSpent, uint256 tokensBurned)',
);

export const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
]);

export interface HookSnapshot {
  blockNumber: bigint;
  accruedEth: bigint;
  burnedTotal: bigint;
  lastBuybackBlock: bigint;
  minBuyback: bigint;
  maxBuyback: bigint;
  feeBps: bigint;
  deadBalance: bigint;
  sqrtPriceX96: bigint | null;
  liquidity: bigint | null;
  hookHasCode: boolean;
  tokenHasCode: boolean;
}

export interface AppContext {
  deployment: LoadedDeployment;
  network: NetworkBlock;
  client: PublicClient;
  chain: Chain;
  poolKey: PoolKey;
  poolId: Hex;
}

/** Wires the deployment into a read client and derived pool identifiers. */
export function createAppContext(deployment: LoadedDeployment): AppContext {
  const network = deployment.manifest.network;
  if (!network) throw new Error('Deployment manifest has no network block; RPC configuration is unavailable');
  const client = createReadClient(network);
  const poolKey = buildPoolKey(deployment.token.address, deployment.hook.address);
  return { deployment, network, client, chain: chainFromNetwork(network), poolKey, poolId: poolIdOf(poolKey) };
}

/** Reads everything the page displays in one pass. */
export async function readHookSnapshot(ctx: AppContext): Promise<HookSnapshot> {
  const { client, deployment, poolId, network } = ctx;
  const hook = { address: deployment.hook.address, abi: deployment.hookAbi } as const;
  const stateView = { address: network.uniswapV4.stateView, abi: STATE_VIEW_ABI } as const;

  // No cache: eligibility compares lastBuybackBlock with the head block, and a
  // refresh after a confirmed transaction must see the new block.
  const [blockNumber, hookCode, tokenCode] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    client.getCode({ address: deployment.hook.address }),
    client.getCode({ address: deployment.token.address }),
  ]);

  const [accruedEth, burnedTotal, lastBuybackBlock, minBuyback, maxBuyback, feeBps, deadBalance] = await Promise.all([
    client.readContract({ ...hook, functionName: 'accruedEth', args: [poolId] }) as Promise<bigint>,
    client.readContract({ ...hook, functionName: 'burnedTotal', args: [poolId] }) as Promise<bigint>,
    client.readContract({ ...hook, functionName: 'lastBuybackBlock', args: [poolId] }) as Promise<bigint>,
    client.readContract({ ...hook, functionName: 'MIN_BUYBACK' }) as Promise<bigint>,
    client.readContract({ ...hook, functionName: 'MAX_BUYBACK' }) as Promise<bigint>,
    client.readContract({ ...hook, functionName: 'FEE_BPS' }) as Promise<bigint>,
    client.readContract({
      address: deployment.token.address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: ['0x000000000000000000000000000000000000dEaD'],
    }),
  ]);

  let sqrtPriceX96: bigint | null = null;
  let liquidity: bigint | null = null;
  try {
    const [slot0, liq] = await Promise.all([
      client.readContract({ ...stateView, functionName: 'getSlot0', args: [poolId] }),
      client.readContract({ ...stateView, functionName: 'getLiquidity', args: [poolId] }),
    ]);
    sqrtPriceX96 = slot0[0];
    liquidity = liq;
  } catch {
    // Pool state is informational; the hook reads above are what the page needs.
  }

  return {
    blockNumber,
    accruedEth,
    burnedTotal,
    lastBuybackBlock,
    minBuyback,
    maxBuyback,
    feeBps,
    deadBalance,
    sqrtPriceX96,
    liquidity,
    hookHasCode: Boolean(hookCode && hookCode !== '0x'),
    tokenHasCode: Boolean(tokenCode && tokenCode !== '0x'),
  };
}

export interface BuybackEvent {
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  ethSpent: bigint;
  tokensBurned: bigint;
}

export interface BuybackEligibility {
  eligible: boolean;
  reasons: string[];
  budget: bigint;
}

/** Snapshot eligibility mirroring `buyback()`'s checks. Not a guarantee of execution. */
export function evaluateEligibility(s: HookSnapshot, nativeSymbol: string, formatWei: (v: bigint) => string): BuybackEligibility {
  const reasons: string[] = [];
  if (s.accruedEth < s.minBuyback) {
    reasons.push(`Pending ${nativeSymbol} is below the ${formatWei(s.minBuyback)} ${nativeSymbol} minimum.`);
  }
  if (s.lastBuybackBlock !== 0n && s.lastBuybackBlock === s.blockNumber) {
    reasons.push('A buyback already ran in the current block. It can run again next block.');
  }
  const budget = s.accruedEth > s.maxBuyback ? s.maxBuyback : s.accruedEth;
  return { eligible: reasons.length === 0, reasons, budget };
}

function isRangeError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return /range|too many|limit|exceed|10k|max/.test(message);
}

/**
 * Fetches Buyback logs for the pool, newest first, walking back from `toBlock`
 * in bounded windows so public RPC range limits are respected. Stops once
 * `limit` events are found or `fromBlock` is reached.
 */
export async function fetchBuybackEvents(
  ctx: AppContext,
  fromBlock: bigint,
  toBlock: bigint,
  limit: number = BUYBACK_EVENT_LIMIT,
): Promise<BuybackEvent[]> {
  const found: BuybackEvent[] = [];
  let chunk = LOG_CHUNK_SIZE;
  let end = toBlock;
  while (end >= fromBlock && found.length < limit) {
    const start = end - chunk + 1n > fromBlock ? end - chunk + 1n : fromBlock;
    try {
      const logs = await ctx.client.getLogs({
        address: ctx.deployment.hook.address,
        event: BUYBACK_EVENT,
        args: { poolId: ctx.poolId },
        fromBlock: start,
        toBlock: end,
      });
      for (const log of logs.reverse()) {
        if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
        found.push({
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          ethSpent: log.args.ethSpent ?? 0n,
          tokensBurned: log.args.tokensBurned ?? 0n,
        });
      }
      end = start - 1n;
    } catch (error) {
      if (chunk > 500n && isRangeError(error)) {
        chunk /= 4n;
        continue;
      }
      throw error;
    }
  }
  return found
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
    .slice(0, limit);
}
