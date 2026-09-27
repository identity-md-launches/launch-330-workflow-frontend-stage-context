import { formatUnits, type Address, type Hex } from 'viem';

const groupFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });

/**
 * Formats a token amount from base units with up to `maxFraction` decimals,
 * grouped thousands and no trailing zeros. Amounts below the shown precision
 * render as "<0.000001"-style so a small nonzero value never reads as zero.
 */
export function formatAmount(value: bigint, decimals: number, maxFraction = 6): string {
  if (value === 0n) return '0';
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ''] = raw.split('.');
  const wholeFormatted = groupFormatter.format(BigInt(whole));
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, '');
  if (trimmed.length === 0) {
    if (whole === '0' || whole === '-0') {
      return `<0.${'0'.repeat(Math.max(0, maxFraction - 1))}1`;
    }
    return wholeFormatted;
  }
  return `${wholeFormatted}.${trimmed}`;
}

/** Compact form for large token counts, e.g. 1.23M. Falls back to grouped digits under 1e6. */
export function formatCompact(value: bigint, decimals: number): string {
  const asNumber = Number(formatUnits(value, decimals));
  if (!Number.isFinite(asNumber)) return formatAmount(value, decimals, 2);
  if (Math.abs(asNumber) < 1_000_000) return formatAmount(value, decimals, 2);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(asNumber);
}

export function shortAddress(address: Address | string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: Hex | string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function explorerAddress(explorer: string, address: Address): string {
  return `${explorer.replace(/\/$/, '')}/address/${address}`;
}

export function explorerTx(explorer: string, hash: Hex): string {
  return `${explorer.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerBlock(explorer: string, block: bigint): string {
  return `${explorer.replace(/\/$/, '')}/block/${block.toString()}`;
}

/** Price of currency1 per currency0 from sqrtPriceX96 (both 18 decimals). */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  return sqrt * sqrt * 10 ** (decimals0 - decimals1);
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

/** Parses a decimal string typed by the visitor into base units; null when invalid. */
export function parseAmountInput(text: string, decimals: number): bigint | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  const padded = (whole || '0') + fraction.padEnd(decimals, '0');
  return BigInt(padded);
}

interface RevertLike {
  name?: string;
  data?: { errorName?: string; args?: readonly unknown[] };
  reason?: string;
  signature?: string;
}

/** Turns wallet and RPC errors into one plain sentence, keeping a decoded revert reason. */
export function describeError(error: unknown): string {
  const e = error as {
    shortMessage?: string;
    message?: string;
    details?: string;
    walk?: (fn: (err: unknown) => boolean) => unknown;
  };
  const revert = typeof e?.walk === 'function' ? (e.walk((x) => (x as RevertLike)?.name === 'ContractFunctionRevertedError') as RevertLike | null) : null;
  if (revert?.data?.errorName) {
    const args = revert.data.args?.length ? `(${revert.data.args.map(String).join(', ')})` : '()';
    return `The contract rejected the call with ${revert.data.errorName}${args}.`;
  }
  if (revert?.reason) return `The contract rejected the call: ${revert.reason}`;
  if (revert?.signature) return `The contract rejected the call with an unknown error ${revert.signature}.`;
  const text = e?.shortMessage ?? e?.details ?? e?.message ?? String(error);
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 220 ? `${firstLine.slice(0, 217)}…` : firstLine;
}
