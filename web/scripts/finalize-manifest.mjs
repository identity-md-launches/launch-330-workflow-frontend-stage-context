#!/usr/bin/env node
/**
 * Finalizes dist/imd-deployment.json after `vite build`.
 *
 * - Starts from web/public/imd-deployment.json (copied into dist/ by Vite),
 *   which carries the handoff identifiers, contract set and network block.
 * - Verifies each referenced ABI file is a JSON array whose canonical keccak
 *   (compact JSON, keys sorted recursively) equals the attested abiHash.
 * - Enumerates every file under dist/ except the manifest itself and records
 *   its lowercase SHA-256.
 * - Enforces the checker limits: at most 128 assets, 8 MiB per file, and a
 *   total export well below the 64 MiB response budget.
 *
 * `--check` verifies the committed manifest instead of rewriting it.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const distDir = resolve(webRoot, '..', 'dist');
const manifestPath = join(distDir, 'imd-deployment.json');
const sourceManifestPath = join(webRoot, 'public', 'imd-deployment.json');
const checkOnly = process.argv.includes('--check');

const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

function canonicalKeccak(value) {
  return keccak256(stringToHex(JSON.stringify(sortKeys(value)))).slice(2);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function fail(message) {
  console.error(`finalize-manifest: ${message}`);
  process.exit(1);
}

const source = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
const existing = JSON.parse(readFileSync(manifestPath, 'utf8'));

for (const field of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash']) {
  if (JSON.stringify(existing[field]) !== JSON.stringify(source[field])) {
    fail(`dist manifest ${field} differs from web/public/imd-deployment.json`);
  }
}
if (JSON.stringify(existing.contracts) !== JSON.stringify(source.contracts)) fail('dist manifest contracts differ from source manifest');
if (JSON.stringify(existing.network) !== JSON.stringify(source.network)) fail('dist manifest network block differs from source manifest');
if (source.version !== 1) fail('manifest version must be 1');
if (!source.network) fail('manifest has no network block');
if (source.network.chainId !== source.chainId) fail('network.chainId must equal chainId');

for (const contract of source.contracts) {
  if (/^[a-z]+:/i.test(contract.abiPath) || contract.abiPath.startsWith('/') || contract.abiPath.split('/').includes('..')) {
    fail(`abiPath for ${contract.name} must be relative to dist/`);
  }
  const abiFile = join(distDir, contract.abiPath);
  let abi;
  try {
    abi = JSON.parse(readFileSync(abiFile, 'utf8'));
  } catch (error) {
    fail(`unable to read ABI ${contract.abiPath}: ${error.message}`);
  }
  if (!Array.isArray(abi)) fail(`ABI ${contract.abiPath} is not a JSON array`);
  const hash = canonicalKeccak(abi);
  if (hash !== contract.abiHash) fail(`ABI hash mismatch for ${contract.name}: ${hash} != ${contract.abiHash}`);
  if (!/^0x[0-9a-f]{40}$/i.test(contract.address)) fail(`address for ${contract.name} is not hex`);
}

const files = walk(distDir).filter((f) => resolve(f) !== resolve(manifestPath));
if (files.length > MAX_ASSETS) fail(`export has ${files.length} assets; limit is ${MAX_ASSETS}`);
let total = 0;
const assets = files.map((file) => {
  const bytes = readFileSync(file);
  const size = statSync(file).size;
  if (size > MAX_FILE_BYTES) fail(`${file} is ${size} bytes; per-file limit is ${MAX_FILE_BYTES}`);
  total += size;
  return { path: relative(distDir, file).split('\\').join('/'), sha256: sha256(bytes) };
});
if (total > MAX_TOTAL_BYTES) fail(`export totals ${total} bytes; keep it under ${MAX_TOTAL_BYTES}`);
if (!assets.some((a) => a.path === 'index.html')) fail('index.html is missing from the export');
for (const contract of source.contracts) {
  if (!assets.some((a) => a.path === contract.abiPath)) fail(`ABI ${contract.abiPath} is not in the export`);
}

const manifest = {
  version: 1,
  launchId: source.launchId,
  chainId: source.chainId,
  sourceCommit: source.sourceCommit,
  attestationHash: source.attestationHash,
  contracts: source.contracts,
  assets,
  network: source.network,
};
const output = `${JSON.stringify(manifest, null, 2)}\n`;

if (checkOnly) {
  const current = readFileSync(manifestPath, 'utf8');
  if (current !== output) {
    fail('dist/imd-deployment.json is stale; run `npm run build` to regenerate it');
  }
  console.log(`finalize-manifest: OK (${assets.length} assets, ${total} bytes, manifest matches export)`);
} else {
  writeFileSync(manifestPath, output);
  console.log(`finalize-manifest: wrote ${relative(process.cwd(), manifestPath)} (${assets.length} assets, ${total} bytes)`);
}
