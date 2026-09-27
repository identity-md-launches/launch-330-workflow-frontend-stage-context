/**
 * In-memory JSON-RPC node and EIP-1193 wallet for interaction tests.
 * No real network, funds or wallet extension are involved.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  numberToHex,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import manifestJson from '../../public/imd-deployment.json';
import hookAbiJson from '../../public/abi/BuybackBurnHook.json';
import tokenAbiJson from '../../public/abi/LaunchToken.json';
import { BUYBACK_EVENT, STATE_VIEW_ABI, ERC20_ABI } from '../chain';
import { PERMIT2_ABI, QUOTER_ABI, UNIVERSAL_ROUTER_ABI } from '../swap';

export const manifest = manifestJson;
export const hookAbi = hookAbiJson as Abi;
export const tokenAbi = tokenAbiJson as Abi;
export const HOOK = manifest.contracts.find((c) => c.name === 'BuybackBurnHook')!.address as Address;
export const TOKEN_ADDRESS = manifest.contracts.find((c) => c.name === 'LaunchToken')!.address as Address;
export const UNI = manifest.network.uniswapV4;
export const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
export const CHAIN_HEX = numberToHex(manifest.chainId);

export interface NodeState {
  blockNumber: bigint;
  accruedEth: bigint;
  burnedTotal: bigint;
  lastBuybackBlock: bigint;
  deadBalance: bigint;
  accountEth: bigint;
  accountToken: bigint;
  erc20Allowance: bigint;
  permit2Amount: bigint;
  permit2Expiration: bigint;
  /** Amount the quoter returns for any exact-input quote. */
  quoteOut: bigint;
  /** Buyback logs, oldest first. */
  buybackLogs: { blockNumber: bigint; ethSpent: bigint; tokensBurned: bigint }[];
  /** Force `buyback` simulation to revert with this custom error name. */
  buybackRevert: string | null;
  /** Force router `execute` simulation to revert with this message. */
  executeRevert: string | null;
  /** Record of every eth_call and transaction the node saw. */
  calls: { to: Address; functionName: string; args: readonly unknown[]; value: bigint }[];
  transactions: { to: Address; functionName: string; args: readonly unknown[]; value: bigint; hash: Hex }[];
  /** Number of eth_getLogs requests and their ranges, to check chunking. */
  logRequests: { from: bigint; to: bigint }[];
  receiptStatus: '0x1' | '0x0';
}

export function defaultState(overrides: Partial<NodeState> = {}): NodeState {
  return {
    blockNumber: 11_800_000n,
    accruedEth: 0n,
    burnedTotal: 0n,
    lastBuybackBlock: 0n,
    deadBalance: 0n,
    accountEth: parseEther('1'),
    accountToken: parseEther('5000'),
    erc20Allowance: 0n,
    permit2Amount: 0n,
    permit2Expiration: 0n,
    quoteOut: parseEther('900'),
    buybackLogs: [],
    buybackRevert: null,
    executeRevert: null,
    calls: [],
    transactions: [],
    logRequests: [],
    receiptStatus: '0x1',
    ...overrides,
  };
}

const abis: Record<string, Abi> = {
  [HOOK.toLowerCase()]: hookAbi,
  [TOKEN_ADDRESS.toLowerCase()]: [...tokenAbi, ...ERC20_ABI] as Abi,
  [UNI.stateView.toLowerCase()]: STATE_VIEW_ABI as Abi,
  [UNI.quoter.toLowerCase()]: QUOTER_ABI as Abi,
  [UNI.permit2.toLowerCase()]: PERMIT2_ABI as Abi,
  [UNI.universalRouter.toLowerCase()]: UNIVERSAL_ROUTER_ABI as Abi,
};

class Revert extends Error {
  constructor(public data: Hex) {
    super('execution reverted');
  }
}

function handleCall(state: NodeState, to: Address, data: Hex, value: bigint): Hex {
  const abi = abis[to.toLowerCase()];
  if (!abi) throw new Error(`no contract at ${to}`);
  const { functionName, args = [] } = decodeFunctionData({ abi, data });
  state.calls.push({ to, functionName, args, value });
  const result = (values: unknown[]) => encodeFunctionResult({ abi, functionName, result: values.length === 1 ? values[0] : values } as never);
  switch (to.toLowerCase()) {
    case HOOK.toLowerCase():
      switch (functionName) {
        case 'accruedEth':
          return result([state.accruedEth]);
        case 'burnedTotal':
          return result([state.burnedTotal]);
        case 'lastBuybackBlock':
          return result([state.lastBuybackBlock]);
        case 'MIN_BUYBACK':
          return result([parseEther('0.001')]);
        case 'MAX_BUYBACK':
          return result([parseEther('0.05')]);
        case 'FEE_BPS':
          return result([100n]);
        case 'buyback':
          if (state.buybackRevert) throw new Revert(encodeErrorResult({ abi: hookAbi, errorName: state.buybackRevert }));
          return '0x';
      }
      break;
    case TOKEN_ADDRESS.toLowerCase():
      switch (functionName) {
        case 'balanceOf': {
          const [owner] = args as [Address];
          if (owner.toLowerCase() === ACCOUNT.toLowerCase()) return result([state.accountToken]);
          if (owner.toLowerCase() === '0x000000000000000000000000000000000000dead') return result([state.deadBalance]);
          return result([0n]);
        }
        case 'allowance':
          return result([state.erc20Allowance]);
        case 'approve':
          return result([true]);
        case 'decimals':
          return result([18]);
      }
      break;
    case UNI.stateView.toLowerCase():
      if (functionName === 'getSlot0') return result([79228162514264337593543950336n * 1000n, 138000, 0, 3000]);
      if (functionName === 'getLiquidity') return result([1_000_000n]);
      break;
    case UNI.quoter.toLowerCase():
      if (functionName === 'quoteExactInputSingle') return result([state.quoteOut, 100_000n]);
      break;
    case UNI.permit2.toLowerCase():
      if (functionName === 'allowance') return result([state.permit2Amount, Number(state.permit2Expiration), 0]);
      if (functionName === 'approve') return '0x';
      break;
    case UNI.universalRouter.toLowerCase():
      if (functionName === 'execute') {
        if (state.executeRevert) {
          throw new Revert(encodeErrorResult({ abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string' }] }], errorName: 'Error', args: [state.executeRevert] }));
        }
        return '0x';
      }
      break;
  }
  throw new Error(`unhandled call ${functionName} on ${to}`);
}

function receiptFor(hash: Hex, state: NodeState) {
  return {
    transactionHash: hash,
    transactionIndex: '0x0',
    blockHash: `0x${'ab'.repeat(32)}`,
    blockNumber: numberToHex(state.blockNumber),
    from: ACCOUNT,
    to: HOOK,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'0'.repeat(512)}`,
    status: state.receiptStatus,
    type: '0x2',
  };
}

/** Handles one JSON-RPC request against the in-memory state. */
export function handleRpc(state: NodeState, method: string, params: unknown[]): unknown {
  switch (method) {
    case 'eth_chainId':
      return CHAIN_HEX;
    case 'eth_blockNumber':
      return numberToHex(state.blockNumber);
    case 'eth_getCode':
      return abis[String(params[0]).toLowerCase()] ? '0x6001' : '0x';
    case 'eth_getBalance':
      return numberToHex(String(params[0]).toLowerCase() === ACCOUNT.toLowerCase() ? state.accountEth : 0n);
    case 'eth_call': {
      const call = params[0] as { to: Address; data: Hex; value?: Hex };
      return handleCall(state, call.to, call.data, call.value ? BigInt(call.value) : 0n);
    }
    case 'eth_estimateGas':
      return '0x5208';
    case 'eth_getLogs': {
      const filter = params[0] as { fromBlock: Hex; toBlock: Hex; address: Address; topics: (Hex | null)[] };
      const from = BigInt(filter.fromBlock);
      const to = BigInt(filter.toBlock);
      state.logRequests.push({ from, to });
      if (to - from > 10_000n) throw Object.assign(new Error('query returned more than 10000 results'), { code: -32005 });
      const [topic0] = encodeEventTopics({ abi: [BUYBACK_EVENT], eventName: 'Buyback' });
      if (filter.topics?.[0] && filter.topics[0] !== topic0) return [];
      return state.buybackLogs
        .map((log, index) => ({ log, index }))
        .filter(({ log }) => log.blockNumber >= from && log.blockNumber <= to)
        .map(({ log, index }) => ({
          address: HOOK,
          topics: [topic0, filter.topics?.[1] ?? `0x${'00'.repeat(32)}`],
          data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [log.ethSpent, log.tokensBurned]),
          blockNumber: numberToHex(log.blockNumber),
          blockHash: `0x${'cd'.repeat(32)}`,
          transactionHash: `0x${index.toString(16).padStart(64, '0')}`,
          transactionIndex: '0x0',
          logIndex: '0x0',
          removed: false,
        }));
    }
    case 'eth_getTransactionReceipt':
      return receiptFor(params[0] as Hex, state);
    case 'eth_getTransactionCount':
      return '0x1';
    case 'eth_gasPrice':
      return '0x1';
    case 'eth_maxPriorityFeePerGas':
      return '0x1';
    case 'eth_getBlockByNumber':
      return { number: numberToHex(state.blockNumber), baseFeePerGas: '0x1', hash: `0x${'ab'.repeat(32)}`, timestamp: '0x1', transactions: [], gasLimit: '0x1', gasUsed: '0x0' };
  }
  throw new Error(`unhandled rpc ${method}`);
}

/** Installs a `fetch` stub that serves the export files and answers RPC calls. */
export function installFetch(state: NodeState) {
  const rpcHosts = manifest.network.rpcUrls;
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (rpcHosts.some((host) => url.startsWith(host))) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string; params: unknown[] };
      try {
        const result = handleRpc(state, body.method, body.params ?? []);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
      } catch (error) {
        const e = error as Error & { data?: Hex; code?: number };
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: e.code ?? 3, message: e.message, data: e.data } }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
    }
    const path = new URL(url).pathname;
    if (path.endsWith('imd-deployment.json')) return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
    if (path.endsWith('abi/BuybackBurnHook.json')) return new Response(JSON.stringify(hookAbiJson), { headers: { 'content-type': 'application/json' } });
    if (path.endsWith('abi/LaunchToken.json')) return new Response(JSON.stringify(tokenAbiJson), { headers: { 'content-type': 'application/json' } });
    return new Response('not found', { status: 404 });
  };
  globalThis.fetch = fetchStub as typeof fetch;
}

export interface MockWalletOptions {
  chainId?: number;
  /** Throw 4902 on the first switch attempt to exercise wallet_addEthereumChain. */
  unknownChainOnce?: boolean;
  rejectSend?: boolean;
  onSend?: (tx: { to: Address; data: Hex; value?: Hex }) => void;
}

/** Minimal EIP-1193 provider that behaves like an injected wallet. */
export function createMockWallet(state: NodeState, options: MockWalletOptions = {}) {
  let chainId = options.chainId ?? manifest.chainId;
  let switchAttempts = 0;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const addChainCalls: unknown[] = [];
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((l) => l(...args));
  const provider = {
    isMetaMask: true,
    addChainCalls,
    get chainId() {
      return chainId;
    },
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ACCOUNT];
        case 'eth_chainId':
          return numberToHex(chainId);
        case 'wallet_switchEthereumChain': {
          switchAttempts += 1;
          if (options.unknownChainOnce && switchAttempts === 1) {
            throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
          }
          chainId = Number.parseInt((params?.[0] as { chainId: string }).chainId, 16);
          emit('chainChanged', numberToHex(chainId));
          return null;
        }
        case 'wallet_addEthereumChain':
          addChainCalls.push(params?.[0]);
          return null;
        case 'eth_sendTransaction': {
          if (options.rejectSend) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          const tx = (params as [{ to: Address; data: Hex; value?: Hex }])[0];
          options.onSend?.(tx);
          const abi = abis[tx.to.toLowerCase()];
          const { functionName, args = [] } = decodeFunctionData({ abi, data: tx.data });
          const hash = `0x${(state.transactions.length + 1).toString(16).padStart(64, '0')}` as Hex;
          state.transactions.push({ to: tx.to, functionName, args, value: tx.value ? BigInt(tx.value) : 0n, hash });
          return hash;
        }
        default:
          return handleRpc(state, method, params ?? []);
      }
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  return provider;
}
