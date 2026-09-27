/**
 * Central configuration.
 *
 * Contract addresses, chain ID, ABIs, public RPC URLs and the Uniswap v4
 * periphery addresses are NOT stored here. They are read at runtime from
 * `imd-deployment.json`, the manifest emitted next to the static export, so the
 * app can never disagree with the attested deployment handoff. This module
 * holds only the manifest location and launch-level constants that the handoff
 * describes but does not carry as fields (the pool parameters from
 * `launch.json`), plus UI tuning knobs.
 */

/** Path of the runtime deployment manifest, relative to the page. */
export const DEPLOYMENT_MANIFEST_PATH = './imd-deployment.json';

/** Contract names as they appear in the deployment manifest. */
export const CONTRACT_NAMES = {
  token: 'LaunchToken',
  hook: 'BuybackBurnHook',
} as const;

/**
 * Pool parameters from the attested launch manifest (`launch.json` → `pool`).
 * `pairedCurrency` is native ETH, so currency0 is the zero address and
 * currency1 is the token. The hook address comes from the deployment manifest.
 */
export const POOL = {
  pairedCurrency: '0x0000000000000000000000000000000000000000' as const,
  fee: 3000,
  tickSpacing: 60,
} as const;

/** Token metadata from the launch manifest; decimals are also read on-chain. */
export const TOKEN = {
  name: 'Ember',
  symbol: 'EMBR',
  decimals: 18,
} as const;

/**
 * Block in which the handoff records the hook deployment (deployment.json →
 * contracts[].blockNumber). Used only as the lower bound of the event scan;
 * addresses and chain still come from the runtime manifest.
 */
export const HOOK_DEPLOYMENT_BLOCK = 11_791_306n;

/** Where burned EMBR is sent. Mirrors `BuybackBurnHook.DEAD`. */
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;

/** How many Buyback events the table shows. */
export const BUYBACK_EVENT_LIMIT = 20;

/** Polling interval for live reads, in milliseconds. */
export const POLL_INTERVAL_MS = 15_000;

/** Largest `eth_getLogs` block window requested from a public RPC. */
export const LOG_CHUNK_SIZE = 10_000n;

/** Default slippage tolerance for swaps, in basis points (0.5%). */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** Swap deadline, in seconds from the time the transaction is prepared. */
export const SWAP_DEADLINE_SECONDS = 20 * 60;

/**
 * Optional WalletConnect project ID. Not supplied for this deployment, so the
 * app offers browser (EIP-6963 / injected) wallets only. Setting
 * `VITE_WALLETCONNECT_PROJECT_ID` at build time records the ID here for a
 * future connector; it is a public identifier, not a credential.
 */
export const WALLETCONNECT_PROJECT_ID: string | undefined =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined;
