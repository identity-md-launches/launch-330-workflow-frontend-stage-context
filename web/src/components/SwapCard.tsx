import { useEffect, useId, useState } from 'react';
import { ERC20_ABI, type AppContext, type HookSnapshot } from '../chain';
import { DEFAULT_SLIPPAGE_BPS, SWAP_DEADLINE_SECONDS, TOKEN } from '../config';
import { describeError, formatAmount, parseAmountInput } from '../format';
import { useTransaction } from '../hooks/useTransaction';
import type { WalletApi } from '../hooks/useWallet';
import {
  MAX_UINT48,
  PERMIT2_ABI,
  UNIVERSAL_ROUTER_ABI,
  applySlippage,
  encodeExactInputSingle,
  quoteExactInputSingle,
  swapDeadline,
} from '../swap';
import { Spinner, StatusMessage } from './Status';
import { TxStatus } from './TxStatus';

interface Props {
  ctx: AppContext;
  snapshot: HookSnapshot | null;
  wallet: WalletApi;
  refresh: () => Promise<void>;
  /** Changes whenever the hook state was re-read; re-reads balances and allowances. */
  refreshKey: number | null;
}

type Direction = 'buy' | 'sell';

interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  direction: Direction;
}

interface Balances {
  native: bigint;
  token: bigint;
  erc20Allowance: bigint;
  permit2Amount: bigint;
  permit2Expiration: bigint;
}

const PERMIT2_TTL_SECONDS = 30n * 24n * 60n * 60n;

/**
 * Buy or sell EMBR through the Uniswap v4 pool. Quotes go through the
 * manifest's quoter via simulation; swaps go through the universal router.
 * Selling shows the two approval steps (ERC-20 → Permit2, Permit2 → router)
 * explicitly before the swap.
 */
export function SwapCard({ ctx, snapshot, wallet, refresh, refreshKey }: Props) {
  const { network, poolKey, client } = ctx;
  const native = network.nativeCurrency;
  const uni = network.uniswapV4;
  const ids = { amount: useId(), slippage: useId(), quote: useId(), amountHelp: useId() };

  const [direction, setDirection] = useState<Direction>('buy');
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState((DEFAULT_SLIPPAGE_BPS / 100).toString());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);

  const approveTx = useTransaction(client, wallet.walletClient);
  const permitTx = useTransaction(client, wallet.walletClient);
  const swapTx = useTransaction(client, wallet.walletClient);

  const inDecimals = direction === 'buy' ? native.decimals : TOKEN.decimals;
  const outDecimals = direction === 'buy' ? TOKEN.decimals : native.decimals;
  const inSymbol = direction === 'buy' ? native.symbol : TOKEN.symbol;
  const outSymbol = direction === 'buy' ? TOKEN.symbol : native.symbol;
  const amountIn = parseAmountInput(amountText, inDecimals);
  const amountValid = amountIn !== null && amountIn > 0n;
  const slippageNumber = Number.parseFloat(slippageText);
  const slippageValid = Number.isFinite(slippageNumber) && slippageNumber >= 0 && slippageNumber <= 50;
  const slippageBps = slippageValid ? Math.round(slippageNumber * 100) : DEFAULT_SLIPPAGE_BPS;
  const contractsLive = snapshot ? snapshot.hookHasCode && snapshot.tokenHasCode : false;
  const anyBusy = approveTx.busy || permitTx.busy || swapTx.busy;

  // Balances and allowances for the connected account, refreshed with each new block snapshot.
  useEffect(() => {
    const account = wallet.account;
    if (!account || !wallet.onTargetChain) {
      setBalances(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = { address: ctx.deployment.token.address, abi: ERC20_ABI } as const;
        const [nativeBalance, tokenBalance, erc20Allowance, permit2] = await Promise.all([
          client.getBalance({ address: account }),
          client.readContract({ ...token, functionName: 'balanceOf', args: [account] }),
          client.readContract({ ...token, functionName: 'allowance', args: [account, uni.permit2] }),
          client.readContract({ address: uni.permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [account, ctx.deployment.token.address, uni.universalRouter] }),
        ]);
        if (!cancelled) {
          setBalances({ native: nativeBalance, token: tokenBalance, erc20Allowance, permit2Amount: permit2[0], permit2Expiration: BigInt(permit2[1]) });
        }
      } catch {
        if (!cancelled) setBalances(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.account, wallet.onTargetChain, refreshKey, client, ctx.deployment.token.address, uni.permit2, uni.universalRouter]);

  // Debounced quote via the quoter (simulation only, never a transaction).
  useEffect(() => {
    if (!amountValid || !contractsLive) {
      setQuote(null);
      setQuoteState('idle');
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteState('loading');
    const timer = window.setTimeout(async () => {
      try {
        const { amountOut } = await quoteExactInputSingle(client, uni.quoter, poolKey, direction === 'buy', amountIn);
        if (!cancelled) {
          setQuote({ amountIn, amountOut, direction });
          setQuoteState('idle');
          setQuoteError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setQuote(null);
          setQuoteState('error');
          setQuoteError(`Unable to quote: ${describeError(error)}`);
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amountIn, amountValid, direction, contractsLive, client, uni.quoter, poolKey, snapshot?.blockNumber]);

  const minOut = quote ? applySlippage(quote.amountOut, slippageBps) : null;
  const quoteFresh = quote !== null && quote.direction === direction && quote.amountIn === amountIn;

  const insufficient = balances && amountValid ? (direction === 'buy' ? amountIn > balances.native : amountIn > balances.token) : false;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const needsErc20Approval = direction === 'sell' && amountValid && balances !== null && balances.erc20Allowance < amountIn;
  const needsPermit2 =
    direction === 'sell' && amountValid && balances !== null && (balances.permit2Amount < amountIn || balances.permit2Expiration <= nowSeconds);

  const blockers: string[] = [];
  if (snapshot && !contractsLive) blockers.push('Contract code was not found at the deployment addresses on this RPC. Swaps stay disabled.');
  if (wallet.status !== 'connected') blockers.push('Connect a wallet to swap.');
  else if (!wallet.onTargetChain) blockers.push(`Your wallet is on another network. Switch to ${network.name} first.`);

  const ready = contractsLive && wallet.onTargetChain && wallet.walletClient !== null && amountValid && quoteFresh && minOut !== null && slippageValid && !insufficient;

  const refreshAfter = async () => {
    await refresh();
  };

  const runApprove = () =>
    approveTx.run({
      simulate: async () => {
        await client.simulateContract({
          address: ctx.deployment.token.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [uni.permit2, amountIn ?? 0n],
          account: wallet.account ?? undefined,
        });
      },
      send: () =>
        wallet.walletClient!.writeContract({
          address: ctx.deployment.token.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [uni.permit2, amountIn ?? 0n],
          account: wallet.account!,
          chain: ctx.chain,
        }),
      onConfirmed: refreshAfter,
    });

  const runPermit = () =>
    permitTx.run({
      simulate: async () => {
        await client.simulateContract({
          address: uni.permit2,
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [ctx.deployment.token.address, uni.universalRouter, amountIn ?? 0n, Number(nowSeconds + PERMIT2_TTL_SECONDS > MAX_UINT48 ? MAX_UINT48 : nowSeconds + PERMIT2_TTL_SECONDS)],
          account: wallet.account ?? undefined,
        });
      },
      send: () =>
        wallet.walletClient!.writeContract({
          address: uni.permit2,
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [ctx.deployment.token.address, uni.universalRouter, amountIn ?? 0n, Number(nowSeconds + PERMIT2_TTL_SECONDS)],
          account: wallet.account!,
          chain: ctx.chain,
        }),
      onConfirmed: refreshAfter,
    });

  const runSwap = () => {
    if (!amountIn || minOut === null) return;
    const { commands, inputs } = encodeExactInputSingle(poolKey, direction === 'buy', amountIn, minOut);
    const deadline = swapDeadline(Date.now() / 1000, SWAP_DEADLINE_SECONDS);
    const value = direction === 'buy' ? amountIn : 0n;
    return swapTx.run({
      simulate: async () => {
        await client.simulateContract({
          address: uni.universalRouter,
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
          value,
          account: wallet.account ?? undefined,
        });
      },
      send: () =>
        wallet.walletClient!.writeContract({
          address: uni.universalRouter,
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
          value,
          account: wallet.account!,
          chain: ctx.chain,
        }),
      onConfirmed: async () => {
        setAmountText('');
        await refreshAfter();
      },
    });
  };

  const balanceIn = balances ? (direction === 'buy' ? balances.native : balances.token) : null;
  const rate =
    quoteFresh && quote && quote.amountIn > 0n
      ? Number(formatAmount(quote.amountOut, outDecimals, 18).replace(/,/g, '')) / Number(formatAmount(quote.amountIn, inDecimals, 18).replace(/,/g, ''))
      : null;

  const steps: { key: string; label: string; needed: boolean; done: boolean; action: () => unknown; tx: typeof approveTx }[] = [
    { key: 'approve', label: `Approve ${TOKEN.symbol} for Permit2`, needed: direction === 'sell', done: direction === 'sell' && !needsErc20Approval && balances !== null, action: runApprove, tx: approveTx },
    { key: 'permit', label: 'Allow the router on Permit2', needed: direction === 'sell', done: direction === 'sell' && !needsPermit2 && balances !== null, action: runPermit, tx: permitTx },
  ];
  const firstOpenStep = steps.find((s) => s.needed && !s.done);

  return (
    <section className="card" aria-labelledby="swap-heading">
      <div className="card-header">
        <h2 id="swap-heading">Trade {TOKEN.symbol}</h2>
        <p className="card-subtitle">
          Swap through the launch pool. Every trade pays the pool's 0.3% fee plus the hook's{' '}
          {snapshot ? Number(snapshot.feeBps) / 100 : 1}% fee, which is burned or set aside for buybacks.
        </p>
      </div>

      <form
        className="swap-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !firstOpenStep && !anyBusy) void runSwap();
        }}
      >
        <fieldset className="segmented">
          <legend className="field-label">Direction</legend>
          <label className={direction === 'buy' ? 'segment segment-active' : 'segment'}>
            <input type="radio" name="direction" value="buy" checked={direction === 'buy'} onChange={() => setDirection('buy')} disabled={anyBusy} />
            Buy {TOKEN.symbol} with {native.symbol}
          </label>
          <label className={direction === 'sell' ? 'segment segment-active' : 'segment'}>
            <input type="radio" name="direction" value="sell" checked={direction === 'sell'} onChange={() => setDirection('sell')} disabled={anyBusy} />
            Sell {TOKEN.symbol} for {native.symbol}
          </label>
        </fieldset>

        <div className="field">
          <div className="field-row">
            <label htmlFor={ids.amount} className="field-label">
              Amount in {inSymbol}
            </label>
            {balanceIn !== null ? (
              <span className="field-hint num">
                Balance: {formatAmount(balanceIn, inDecimals, direction === 'buy' ? 6 : 2)} {inSymbol}
              </span>
            ) : null}
          </div>
          <div className="input-row">
            <input
              id={ids.amount}
              className="input num"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder={direction === 'buy' ? '0.01' : '1000'}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              disabled={anyBusy}
              aria-describedby={ids.amountHelp}
              aria-invalid={amountText !== '' && (!amountValid || insufficient) ? true : undefined}
            />
            {balanceIn !== null && direction === 'sell' ? (
              <button type="button" className="button button-secondary" disabled={anyBusy} onClick={() => setAmountText(formatAmount(balanceIn, inDecimals, 18).replace(/,/g, ''))}>
                Max
              </button>
            ) : null}
          </div>
          <p id={ids.amountHelp} className="field-help">
            {amountText !== '' && !amountValid
              ? `Enter a positive number with at most ${inDecimals} decimals.`
              : insufficient
                ? `Amount exceeds your ${inSymbol} balance.`
                : direction === 'buy'
                  ? `Leave some ${native.symbol} for gas.`
                  : 'Exact input: you sell this amount and receive at least the minimum shown.'}
          </p>
        </div>

        <div className="field field-inline">
          <label htmlFor={ids.slippage} className="field-label">
            Max slippage (%)
          </label>
          <input
            id={ids.slippage}
            className="input input-short num"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={slippageText}
            onChange={(event) => setSlippageText(event.target.value)}
            disabled={anyBusy}
            aria-invalid={!slippageValid ? true : undefined}
            aria-describedby={!slippageValid ? `${ids.slippage}-error` : undefined}
          />
          {!slippageValid ? (
            <p id={`${ids.slippage}-error`} className="field-help">
              Use a value between 0 and 50.
            </p>
          ) : null}
        </div>

        <div className="quote" id={ids.quote} aria-live="polite">
          {quoteState === 'loading' ? (
            <p className="muted">
              <Spinner /> Fetching quote…
            </p>
          ) : quoteState === 'error' && quoteError ? (
            <StatusMessage tone="error">{quoteError}</StatusMessage>
          ) : quoteFresh && quote && minOut !== null ? (
            <dl className="facts facts-compact">
              <div className="fact">
                <dt>You receive about</dt>
                <dd className="num">
                  {formatAmount(quote.amountOut, outDecimals, direction === 'buy' ? 2 : 6)} {outSymbol}
                </dd>
              </div>
              <div className="fact">
                <dt>Minimum after slippage</dt>
                <dd className="num">
                  {formatAmount(minOut, outDecimals, direction === 'buy' ? 2 : 6)} {outSymbol}
                </dd>
              </div>
              <div className="fact">
                <dt>Rate</dt>
                <dd className="num">
                  {rate !== null && Number.isFinite(rate) ? `1 ${inSymbol} ≈ ${new Intl.NumberFormat('en-US', { maximumFractionDigits: rate >= 1 ? 2 : 8 }).format(rate)} ${outSymbol}` : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Enter an amount to see a quote. Quotes include both fees.</p>
          )}
        </div>

        {direction === 'sell' ? (
          <ol className="steps" aria-label="Sell steps">
            {steps.map((step, index) => {
              const current = firstOpenStep?.key === step.key;
              return (
                <li key={step.key} className={step.done ? 'step step-done' : current ? 'step step-current' : 'step'}>
                  <span className="step-index" aria-hidden="true">
                    {step.done ? '✓' : index + 1}
                  </span>
                  <span className="step-body">
                    <span className="step-label">
                      {step.label}
                      {step.done ? <span className="sr-only"> (done)</span> : null}
                    </span>
                    {current ? (
                      <button type="button" className="button button-primary" disabled={!ready || anyBusy} onClick={() => void step.action()}>
                        {step.tx.busy ? <Spinner /> : null} {step.label}
                      </button>
                    ) : null}
                    <TxStatus state={step.tx.state} explorer={network.explorer} />
                  </span>
                </li>
              );
            })}
            <li className={firstOpenStep ? 'step' : 'step step-current'}>
              <span className="step-index" aria-hidden="true">
                3
              </span>
              <span className="step-body">
                <span className="step-label">Swap</span>
                {!firstOpenStep ? (
                  <button type="submit" className="button button-primary" disabled={!ready || anyBusy}>
                    {swapTx.busy ? <Spinner /> : null} Sell {TOKEN.symbol}
                  </button>
                ) : null}
              </span>
            </li>
          </ol>
        ) : (
          <div className="actions">
            <button type="submit" className="button button-primary button-large" disabled={!ready || anyBusy}>
              {swapTx.busy ? <Spinner /> : null} Buy {TOKEN.symbol}
            </button>
          </div>
        )}

        <p className="muted small">
          {direction === 'buy'
            ? `Sends ${amountValid && amountIn ? formatAmount(amountIn, inDecimals, 6) : 'the amount'} ${native.symbol} as transaction value to the universal router. No approval is needed.`
            : `Selling needs two approvals the first time: ${TOKEN.symbol} to Permit2, then Permit2 to the universal router.`}{' '}
          The swap is simulated before your wallet asks you to sign.
        </p>

        {blockers.map((blocker) => (
          <StatusMessage key={blocker} tone="info">
            {blocker}
          </StatusMessage>
        ))}
        <TxStatus state={swapTx.state} explorer={network.explorer} />
      </form>
    </section>
  );
}
