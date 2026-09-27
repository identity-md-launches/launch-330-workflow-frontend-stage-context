import { keccak256, stringToHex, type Abi, type Address } from 'viem';
import { CONTRACT_NAMES, DEPLOYMENT_MANIFEST_PATH } from './config';

export interface DeploymentContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface DeploymentAsset {
  path: string;
  sha256: string;
}

export interface UniswapV4Addresses {
  poolManager: Address;
  universalRouter: Address;
  quoter: Address;
  stateView: Address;
  positionManager: Address;
  permit2: Address;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: UniswapV4Addresses;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: DeploymentContract[];
  assets: DeploymentAsset[];
  network?: NetworkBlock;
}

export interface LoadedDeployment {
  manifest: DeploymentManifest;
  token: DeploymentContract;
  hook: DeploymentContract;
  tokenAbi: Abi;
  hookAbi: Abi;
}

/** Recursively sorts object keys so JSON output is canonical. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

/** keccak256 of the compact, key-sorted JSON encoding, as 64 lowercase hex chars. */
export function canonicalKeccak(value: unknown): string {
  return keccak256(stringToHex(JSON.stringify(sortKeys(value)))).slice(2);
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_HASH = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new Error(message);
}

function assertAddress(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !HEX_ADDRESS.test(value)) fail(`${label} is not an address`);
  return value as Address;
}

function assertRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} is missing`);
  if (/^[a-z]+:/i.test(value) || value.startsWith('/') || value.split('/').includes('..')) {
    fail(`${label} must be a relative path inside the export`);
  }
  return value;
}

/** Validates the manifest shape before anything trusts it. */
export function parseManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== 'object') fail('Deployment manifest is not an object');
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) fail('Deployment manifest version is not 1');
  if (typeof m.launchId !== 'string' || !m.launchId) fail('Deployment manifest has no launchId');
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0) {
    fail('Deployment manifest chainId is invalid');
  }
  if (typeof m.sourceCommit !== 'string') fail('Deployment manifest has no sourceCommit');
  if (typeof m.attestationHash !== 'string') fail('Deployment manifest has no attestationHash');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) fail('Deployment manifest lists no contracts');
  const contracts: DeploymentContract[] = m.contracts.map((c, i) => {
    const entry = c as Record<string, unknown>;
    if (typeof entry.name !== 'string' || !entry.name) fail(`Contract ${i} has no name`);
    if (typeof entry.abiHash !== 'string' || !HEX_HASH.test(entry.abiHash)) fail(`Contract ${entry.name} abiHash is invalid`);
    return {
      name: entry.name,
      address: assertAddress(entry.address, `Contract ${entry.name} address`),
      abiHash: entry.abiHash,
      abiPath: assertRelativePath(entry.abiPath, `Contract ${entry.name} abiPath`),
    };
  });
  const assets: DeploymentAsset[] = Array.isArray(m.assets)
    ? m.assets.map((a, i) => {
        const entry = a as Record<string, unknown>;
        if (typeof entry.sha256 !== 'string' || !HEX_HASH.test(entry.sha256)) fail(`Asset ${i} sha256 is invalid`);
        return { path: assertRelativePath(entry.path, `Asset ${i} path`), sha256: entry.sha256 };
      })
    : [];

  let network: NetworkBlock | undefined;
  if (m.network !== undefined) {
    const n = m.network as Record<string, unknown>;
    if (!n || typeof n !== 'object') fail('network block is not an object');
    if (n.chainId !== m.chainId) fail('network.chainId does not match manifest chainId');
    if (typeof n.name !== 'string') fail('network.name is missing');
    if (!Array.isArray(n.rpcUrls) || n.rpcUrls.length === 0) fail('network.rpcUrls is empty');
    for (const url of n.rpcUrls) {
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) fail('network.rpcUrls must be https URLs');
    }
    if (typeof n.explorer !== 'string') fail('network.explorer is missing');
    const nc = n.nativeCurrency as Record<string, unknown> | undefined;
    if (!nc || typeof nc.symbol !== 'string' || typeof nc.decimals !== 'number') fail('network.nativeCurrency is invalid');
    const u = n.uniswapV4 as Record<string, unknown> | undefined;
    if (!u) fail('network.uniswapV4 is missing');
    network = {
      chainId: n.chainId as number,
      name: n.name,
      testnet: Boolean(n.testnet),
      rpcUrls: n.rpcUrls as string[],
      explorer: n.explorer,
      nativeCurrency: { name: String(nc.name ?? nc.symbol), symbol: nc.symbol, decimals: nc.decimals },
      faucets: Array.isArray(n.faucets) ? (n.faucets as string[]) : [],
      uniswapV4: {
        poolManager: assertAddress(u.poolManager, 'uniswapV4.poolManager'),
        universalRouter: assertAddress(u.universalRouter, 'uniswapV4.universalRouter'),
        quoter: assertAddress(u.quoter, 'uniswapV4.quoter'),
        stateView: assertAddress(u.stateView, 'uniswapV4.stateView'),
        positionManager: assertAddress(u.positionManager, 'uniswapV4.positionManager'),
        permit2: assertAddress(u.permit2, 'uniswapV4.permit2'),
      },
    };
  }

  return {
    version: 1,
    launchId: m.launchId,
    chainId: m.chainId,
    sourceCommit: m.sourceCommit,
    attestationHash: m.attestationHash,
    contracts,
    assets,
    network,
  };
}

/** Resolves a manifest-relative path against the page URL. */
export function resolveAssetUrl(relativePath: string, base: string = document.baseURI): string {
  return new URL(relativePath, base).toString();
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Unable to load ${url} (HTTP ${response.status})`);
  return response.json();
}

/**
 * Loads `imd-deployment.json`, then each ABI it references, and checks every
 * ABI against the attested `abiHash` before returning.
 */
export async function loadDeployment(
  manifestPath: string = DEPLOYMENT_MANIFEST_PATH,
  fetchImpl: (url: string) => Promise<unknown> = fetchJson,
): Promise<LoadedDeployment> {
  const manifestUrl = resolveAssetUrl(manifestPath);
  const manifest = parseManifest(await fetchImpl(manifestUrl));

  const byName = new Map(manifest.contracts.map((c) => [c.name, c]));
  const token = byName.get(CONTRACT_NAMES.token) ?? fail(`Manifest has no ${CONTRACT_NAMES.token} contract`);
  const hook = byName.get(CONTRACT_NAMES.hook) ?? fail(`Manifest has no ${CONTRACT_NAMES.hook} contract`);

  const loadAbi = async (contract: DeploymentContract): Promise<Abi> => {
    const abi = await fetchImpl(resolveAssetUrl(contract.abiPath, manifestUrl));
    if (!Array.isArray(abi)) fail(`ABI for ${contract.name} is not a JSON array`);
    const hash = canonicalKeccak(abi);
    if (hash !== contract.abiHash) {
      fail(`ABI for ${contract.name} does not match the attested hash (${hash.slice(0, 12)}… vs ${contract.abiHash.slice(0, 12)}…)`);
    }
    return abi as Abi;
  };

  const [tokenAbi, hookAbi] = await Promise.all([loadAbi(token), loadAbi(hook)]);
  return { manifest, token, hook, tokenAbi, hookAbi };
}
