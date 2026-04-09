import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  calculateNepseCost,
  createExecutionDecision,
  fetchExecutionDecisions,
  fetchWatchlist,
  removeExecutionDecision,
  updateExecutionDecision,
} from '../../lib/api';
import {
  ExecutionDecisionEntry,
  ExecutionDecisionOutcome,
  ExecutionDecisionSide,
  NepseCostResponse,
  WatchlistApiRow,
} from '../../types';
import { getAuthToken } from '../../lib/auth';

type Side = 'buy' | 'sell';

interface FormState {
  side: Side;
  symbol: string;
  price: string;
  qty: string;
  buyPrice: string;
  holdingDays: string;
  targetPrice: string;
  stopLoss: string;
  scenarioHoldingDays: string;
}

interface ScenarioResult {
  targetPrice: number | null;
  stopLoss: number | null;
  targetNet: number | null;
  targetPnl: number | null;
  targetBreakdown: NepseCostResponse['breakdown'] | null;
  stopNet: number | null;
  stopPnl: number | null;
  stopBreakdown: NepseCostResponse['breakdown'] | null;
}

interface RiskPlanState {
  capital: string;
  riskPercent: string;
  entryPrice: string;
  stopPrice: string;
  targetPrice: string;
}

interface RiskPlanSummary {
  maxRiskAmount: number;
  riskPerShare: number;
  suggestedQty: number;
  positionValue: number;
  potentialLoss: number;
  potentialGain: number | null;
  riskRewardRatio: number | null;
  capitalUsagePct: number;
  warning: string | null;
}

interface DecisionDraft {
  side: ExecutionDecisionSide;
  symbol: string;
  reason: string;
  plan: string;
  confidence: string;
}

type ChecklistKey =
  | 'trendConfirmed'
  | 'entryTrigger'
  | 'riskWithinLimit'
  | 'rewardAtLeast2R'
  | 'newsChecked';

const CHECKLIST_ITEMS: Array<{ key: ChecklistKey; label: string }> = [
  { key: 'trendConfirmed', label: 'Higher-timeframe trend confirmed' },
  { key: 'entryTrigger', label: 'Entry trigger validated on current timeframe' },
  { key: 'riskWithinLimit', label: 'Risk stays within my rule (max 1-2% capital)' },
  { key: 'rewardAtLeast2R', label: 'Target supports at least 2R reward:risk' },
  { key: 'newsChecked', label: 'Checked major news/events before entry' },
];

const INITIAL_RISK_PLAN: RiskPlanState = {
  capital: '500000',
  riskPercent: '1',
  entryPrice: '',
  stopPrice: '',
  targetPrice: '',
};

const INITIAL_CHECKLIST: Record<ChecklistKey, boolean> = {
  trendConfirmed: false,
  entryTrigger: false,
  riskWithinLimit: false,
  rewardAtLeast2R: false,
  newsChecked: false,
};

const MAX_DECISION_ENTRIES = 120;

const INITIAL_DECISION_DRAFT: DecisionDraft = {
  side: 'BUY',
  symbol: '',
  reason: '',
  plan: '',
  confidence: '3',
};

const INITIAL_FORM: FormState = {
  side: 'buy',
  symbol: '',
  price: '',
  qty: '100',
  buyPrice: '',
  holdingDays: '',
  targetPrice: '',
  stopLoss: '',
  scenarioHoldingDays: '180',
};

function formatMoney(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRate(rate: number | null): string {
  if (rate === null) return '-';
  const percentage = rate <= 1 ? rate * 100 : rate;
  return `${percentage.toFixed(3)}%`;
}

function explainCharge(charge: string): string {
  const normalized = charge.toLowerCase();
  if (normalized.includes('broker')) return 'broker commission charged by broker slab';
  if (normalized.includes('sebon')) return 'regulatory fee charged by SEBON';
  if (normalized.includes('dp')) return 'fixed demat participant charge';
  if (normalized.includes('cgt')) return 'capital gains tax for sell transactions';
  if (normalized.includes('turnover') || normalized.includes('transaction')) return 'price x quantity';
  if (normalized.includes('net')) return 'amount credited after all deductions';
  if (normalized.includes('total')) return 'sum of all applicable charges';
  return 'exchange/broker rule-based charge';
}

export function CalculatorTerminalPage() {
  const hasAuth = Boolean(getAuthToken());
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [result, setResult] = useState<NepseCostResponse | null>(null);
  const [scenario, setScenario] = useState<ScenarioResult | null>(null);
  const [riskPlan, setRiskPlan] = useState<RiskPlanState>(INITIAL_RISK_PLAN);
  const [checklist, setChecklist] = useState<Record<ChecklistKey, boolean>>(INITIAL_CHECKLIST);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft>(INITIAL_DECISION_DRAFT);
  const [decisionEntries, setDecisionEntries] = useState<ExecutionDecisionEntry[]>([]);
  const [decisionError, setDecisionError] = useState('');
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchWatchlist()
      .then((rows) => setWatchlist(rows))
      .catch(() => setWatchlist([]));
  }, []);

  useEffect(() => {
    setDecisionDraft((previous) => ({
      ...previous,
      side: form.side === 'buy' ? 'BUY' : 'SELL',
    }));
  }, [form.side]);

  useEffect(() => {
    if (!hasAuth) {
      setDecisionEntries([]);
      return;
    }

    setDecisionLoading(true);
    fetchExecutionDecisions({ limit: MAX_DECISION_ENTRIES })
      .then((rows) => {
        setDecisionEntries(rows);
        setDecisionError('');
      })
      .catch((requestError) => {
        setDecisionEntries([]);
        setDecisionError(requestError instanceof Error ? requestError.message : 'Failed to load decision diary.');
      })
      .finally(() => {
        setDecisionLoading(false);
      });
  }, [hasAuth]);

  const applySymbol = (symbolInput: string) => {
    const lookup = symbolInput.trim().toLowerCase();
    const selected = watchlist.find(
      (item) => item.symbol.toLowerCase() === lookup || (item.company ?? '').toLowerCase() === lookup,
    );

    setForm((previous) => {
      if (!selected) {
        return { ...previous, symbol: symbolInput.trim().toUpperCase() };
      }

      return {
        ...previous,
        symbol: selected.symbol,
        price: String(selected.ltp),
        buyPrice: previous.buyPrice || String(selected.ltp),
      };
    });
  };

  const summary = useMemo(() => {
    if (!result) return null;

    if (form.side === 'buy') {
      return {
        heading: 'Total Amount To Pay',
        value: result.totalAmountToPay ?? 0,
        lineOneLabel: 'Transaction Value',
        lineOneValue: result.transactionValue,
        lineTwoLabel: 'Total Charges',
        lineTwoValue: result.totalCharges,
      };
    }

    return {
      heading: 'Net Proceeds',
      value: result.netProceeds ?? 0,
      lineOneLabel: 'Transaction Value',
      lineOneValue: result.transactionValue,
      lineTwoLabel: 'Total Deductions',
      lineTwoValue: result.totalDeductions,
    };
  }, [form.side, result]);

  const riskSummary = useMemo<RiskPlanSummary | null>(() => {
    const capital = Number(riskPlan.capital);
    const riskPercent = Number(riskPlan.riskPercent);
    const entryPrice = Number(riskPlan.entryPrice);
    const stopPrice = Number(riskPlan.stopPrice);
    const targetPrice = Number(riskPlan.targetPrice);

    if (
      !Number.isFinite(capital) ||
      !Number.isFinite(riskPercent) ||
      !Number.isFinite(entryPrice) ||
      !Number.isFinite(stopPrice) ||
      capital <= 0 ||
      riskPercent <= 0 ||
      entryPrice <= 0 ||
      stopPrice <= 0
    ) {
      return null;
    }

    const maxRiskAmount = capital * (riskPercent / 100);
    const riskPerShare = entryPrice - stopPrice;

    if (riskPerShare <= 0) {
      return {
        maxRiskAmount,
        riskPerShare,
        suggestedQty: 0,
        positionValue: 0,
        potentialLoss: 0,
        potentialGain: null,
        riskRewardRatio: null,
        capitalUsagePct: 0,
        warning: 'Stop-loss must be below entry for long positions.',
      };
    }

    const suggestedQty = Math.max(0, Math.floor(maxRiskAmount / riskPerShare));
    const positionValue = suggestedQty * entryPrice;
    const potentialLoss = suggestedQty * riskPerShare;
    const capitalUsagePct = capital > 0 ? (positionValue / capital) * 100 : 0;

    const hasTarget = Number.isFinite(targetPrice) && targetPrice > entryPrice;
    const rewardPerShare = hasTarget ? targetPrice - entryPrice : null;
    const potentialGain = hasTarget && rewardPerShare !== null ? suggestedQty * rewardPerShare : null;
    const riskRewardRatio =
      potentialGain !== null && potentialLoss > 0 ? potentialGain / potentialLoss : null;

    const warning =
      suggestedQty < 1
        ? 'Risk budget is too small for this stop distance. Reduce stop distance or increase risk budget.'
        : capitalUsagePct > 100
          ? 'Required position value exceeds available capital.'
          : null;

    return {
      maxRiskAmount,
      riskPerShare,
      suggestedQty,
      positionValue,
      potentialLoss,
      potentialGain,
      riskRewardRatio,
      capitalUsagePct,
      warning,
    };
  }, [riskPlan]);

  const checklistCompleted = useMemo(
    () => Object.values(checklist).filter(Boolean).length,
    [checklist],
  );

  const decisionSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayEntries = decisionEntries.filter((entry) => entry.tradeDate === today);
    const reviewed = todayEntries.filter((entry) => entry.outcome !== 'PENDING');
    const correct = reviewed.filter((entry) => entry.outcome === 'CORRECT').length;

    return {
      totalToday: todayEntries.length,
      reviewedToday: reviewed.length,
      pendingToday: todayEntries.length - reviewed.length,
      correctToday: correct,
      hitRate: reviewed.length > 0 ? (correct / reviewed.length) * 100 : 0,
      latest: [...todayEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
    };
  }, [decisionEntries]);

  const syncDraftFromCalculator = () => {
    setDecisionDraft((previous) => ({
      ...previous,
      side: form.side === 'buy' ? 'BUY' : 'SELL',
      symbol: form.symbol || previous.symbol,
      plan:
        form.side === 'buy'
          ? `Entry ${form.price || '-'} | Target ${form.targetPrice || '-'} | Stop ${form.stopLoss || '-'}`
          : `Exit ${form.price || '-'} | Buy Ref ${form.buyPrice || '-'} | Holding Days ${form.holdingDays || '-'}`,
    }));
  };

  const addDecisionEntry = () => {
    if (!hasAuth) {
      setDecisionError('Please login to save and sync decision diary across devices.');
      return;
    }

    const symbol = decisionDraft.symbol.trim().toUpperCase();
    const reason = decisionDraft.reason.trim();
    const plan = decisionDraft.plan.trim();
    const confidence = Number(decisionDraft.confidence);

    if (!symbol) {
      setDecisionError('Symbol is required for decision note.');
      return;
    }

    if (reason.length < 8) {
      setDecisionError('Please add a short reason (minimum 8 characters).');
      return;
    }

    if (!Number.isFinite(confidence) || confidence < 1 || confidence > 5) {
      setDecisionError('Confidence must be between 1 and 5.');
      return;
    }

    setDecisionLoading(true);
    createExecutionDecision({
      side: decisionDraft.side,
      symbol,
      reason,
      plan,
      confidence,
    })
      .then((entry) => {
        setDecisionEntries((previous) => [entry, ...previous].slice(0, MAX_DECISION_ENTRIES));
        setDecisionDraft((previous) => ({
          ...previous,
          reason: '',
          plan: '',
        }));
        setDecisionError('');
      })
      .catch((requestError) => {
        setDecisionError(requestError instanceof Error ? requestError.message : 'Failed to save decision note.');
      })
      .finally(() => {
        setDecisionLoading(false);
      });
  };

  const patchDecisionEntry = (id: number, updates: {
    outcome?: ExecutionDecisionOutcome;
    reviewNote?: string;
  }) => {
    if (!hasAuth) return;

    setDecisionEntries((previous) =>
      previous.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)),
    );

    updateExecutionDecision(id, updates)
      .then((updated) => {
        setDecisionEntries((previous) =>
          previous.map((entry) => (entry.id === id ? updated : entry)),
        );
      })
      .catch((requestError) => {
        setDecisionError(requestError instanceof Error ? requestError.message : 'Failed to update decision note.');
      });
  };

  const markDecisionReviewed = (id: number, outcome: ExecutionDecisionOutcome) => {
    if (!hasAuth) return;

    updateExecutionDecision(id, { outcome })
      .then((updated) => {
        setDecisionEntries((previous) =>
          previous.map((entry) => (entry.id === id ? updated : entry)),
        );
      })
      .catch((requestError) => {
        setDecisionError(requestError instanceof Error ? requestError.message : 'Failed to mark review.');
      });
  };

  const deleteDecisionEntry = (id: number) => {
    if (!hasAuth) return;

    removeExecutionDecision(id)
      .then(() => {
        setDecisionEntries((previous) => previous.filter((entry) => entry.id !== id));
      })
      .catch((requestError) => {
        setDecisionError(requestError instanceof Error ? requestError.message : 'Failed to delete decision note.');
      });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setLoading(true);
    setError('');

    try {
      const price = Number(form.price);
      const qty = Number(form.qty);
      const buyPrice = Number(form.buyPrice);
      const holdingDays = Number(form.holdingDays);
      const targetPrice = Number(form.targetPrice);
      const stopLoss = Number(form.stopLoss);
      const scenarioHoldingDays = Number(form.scenarioHoldingDays);

      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('Price and quantity must be valid positive numbers.');
      }

      if (form.side === 'sell' && (!Number.isFinite(buyPrice) || buyPrice <= 0)) {
        throw new Error('Original buy price is required for sell-side CGT.');
      }

      if (form.side === 'sell' && (!Number.isFinite(holdingDays) || holdingDays < 0)) {
        throw new Error('Holding days must be a valid non-negative number.');
      }

      const payload = {
        isBuy: form.side === 'buy',
        price,
        qty,
        instrumentType: 'equity' as const,
        buyPrice: form.side === 'sell' ? buyPrice : null,
        holdingDays: form.side === 'sell' ? holdingDays : null,
        traderType: 'individual' as const,
      };

      const response = await calculateNepseCost(payload);
      setResult(response);

      if (form.side === 'buy') {
        const requestDays = Number.isFinite(scenarioHoldingDays) && scenarioHoldingDays >= 0 ? scenarioHoldingDays : 180;

        const sellRequests: Array<Promise<NepseCostResponse>> = [];
        const hasTarget = Number.isFinite(targetPrice) && targetPrice > 0;
        const hasStop = Number.isFinite(stopLoss) && stopLoss > 0;

        if (hasTarget) {
          sellRequests.push(
            calculateNepseCost({
              isBuy: false,
              price: targetPrice,
              qty,
              instrumentType: 'equity',
              buyPrice: price,
              holdingDays: requestDays,
              traderType: 'individual',
            }),
          );
        }

        if (hasStop) {
          sellRequests.push(
            calculateNepseCost({
              isBuy: false,
              price: stopLoss,
              qty,
              instrumentType: 'equity',
              buyPrice: price,
              holdingDays: requestDays,
              traderType: 'individual',
            }),
          );
        }

        if (sellRequests.length) {
          const sellResults = await Promise.all(sellRequests);

          const targetResult = hasTarget ? sellResults[0] : null;
          const stopResult = hasStop ? sellResults[sellResults.length - 1] : null;

          const buyIn = response.totalAmountToPay ?? 0;
          setScenario({
            targetPrice: hasTarget ? targetPrice : null,
            stopLoss: hasStop ? stopLoss : null,
            targetNet: targetResult?.netProceeds ?? null,
            targetPnl: targetResult?.netProceeds !== null && targetResult?.netProceeds !== undefined ? targetResult.netProceeds - buyIn : null,
            targetBreakdown: targetResult?.breakdown ?? null,
            stopNet: stopResult?.netProceeds ?? null,
            stopPnl: stopResult?.netProceeds !== null && stopResult?.netProceeds !== undefined ? stopResult.netProceeds - buyIn : null,
            stopBreakdown: stopResult?.breakdown ?? null,
          });
        } else {
          setScenario(null);
        }
      } else {
        setScenario(null);
      }
    } catch (submissionError) {
      setResult(null);
      setScenario(null);
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to calculate.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">NEPSE Cost Engine</p>
        <h1 className="text-xl font-semibold text-white sm:text-2xl">Buy/Sell Calculator</h1>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={onSubmit} className="terminal-card space-y-4 p-4 dark:bg-zinc-900 sm:p-6">
          <div className="space-y-1">
            <label htmlFor="symbol" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Company Quick Fill
            </label>
            <input
              id="symbol"
              list="watchlist-symbol-options"
              value={form.symbol}
              onChange={(event) => applySymbol(event.target.value)}
              className="terminal-input"
              placeholder="Type symbol or company name"
            />
            <datalist id="watchlist-symbol-options">
              {watchlist.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol} {item.company ? `- ${item.company}` : ''}
                </option>
              ))}
              {watchlist
                .filter((item) => item.company)
                .map((item) => (
                  <option key={`${item.symbol}-company`} value={item.company ?? ''}>
                    {item.company} ({item.symbol})
                  </option>
                ))}
            </datalist>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="price" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Price (NPR)
              </label>
              <input
                id="price"
                type="number"
                value={form.price}
                onChange={(event) => setForm((old) => ({ ...old, price: event.target.value }))}
                className="terminal-input font-mono"
                placeholder="850.00"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="qty" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Quantity
              </label>
              <input
                id="qty"
                type="number"
                value={form.qty}
                onChange={(event) => setForm((old) => ({ ...old, qty: event.target.value }))}
                className="terminal-input font-mono"
                required
              />
            </div>
          </div>

          {form.side === 'buy' ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="targetPrice" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Target Price
                </label>
                <input
                  id="targetPrice"
                  type="number"
                  value={form.targetPrice}
                  onChange={(event) => setForm((old) => ({ ...old, targetPrice: event.target.value }))}
                  className="terminal-input font-mono"
                  placeholder="920"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="stopLoss" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Stop-Loss Price
                </label>
                <input
                  id="stopLoss"
                  type="number"
                  value={form.stopLoss}
                  onChange={(event) => setForm((old) => ({ ...old, stopLoss: event.target.value }))}
                  className="terminal-input font-mono"
                  placeholder="790"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="scenarioHoldingDays" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Scenario Holding Days
                </label>
                <input
                  id="scenarioHoldingDays"
                  type="number"
                  value={form.scenarioHoldingDays}
                  onChange={(event) => setForm((old) => ({ ...old, scenarioHoldingDays: event.target.value }))}
                  className="terminal-input font-mono"
                />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm((old) => ({ ...old, side: 'buy' }))}
              className={
                form.side === 'buy'
                  ? 'terminal-btn-primary border-terminal-green bg-terminal-green/15 text-terminal-green'
                  : 'terminal-btn'
              }
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setForm((old) => ({ ...old, side: 'sell' }))}
              className={
                form.side === 'sell'
                  ? 'terminal-btn-primary border-terminal-red bg-terminal-red/15 text-terminal-red'
                  : 'terminal-btn'
              }
            >
              Sell
            </button>
          </div>

          {form.side === 'sell' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="buyPrice" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Buy Price
                </label>
                <input
                  id="buyPrice"
                  type="number"
                  value={form.buyPrice}
                  onChange={(event) => setForm((old) => ({ ...old, buyPrice: event.target.value }))}
                  className="terminal-input font-mono"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="holdingDays" className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Holding Days
                </label>
                <input
                  id="holdingDays"
                  type="number"
                  value={form.holdingDays}
                  onChange={(event) => setForm((old) => ({ ...old, holdingDays: event.target.value }))}
                  className="terminal-input font-mono"
                  required
                />
              </div>
            </div>
          ) : null}

          <button type="submit" disabled={loading} className="terminal-btn-primary w-full py-2.5">
            {loading ? 'Calculating...' : 'Calculate'}
          </button>

          {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
        </form>

        <aside className="terminal-card p-4 sm:p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Result Snapshot</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Execution Cost Summary</h2>

          <div className="mt-5 rounded-xl border border-zinc-700/70 bg-black/60 p-4 sm:p-5">
            <p className="text-sm text-zinc-400">{summary?.heading ?? 'Total Amount To Pay'}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white font-mono sm:text-4xl">
              ₹ {summary ? formatMoney(summary.value) : '0.00'}
            </p>
          </div>

          <dl className="mt-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <dt className="text-sm text-zinc-400">{summary?.lineOneLabel ?? 'Transaction Value'}</dt>
              <dd className="font-mono text-base font-semibold text-white">₹ {summary ? formatMoney(summary.lineOneValue) : '0.00'}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <dt className="text-sm text-zinc-400">{summary?.lineTwoLabel ?? 'Total Charges'}</dt>
              <dd className="font-mono text-base font-semibold text-white">₹ {summary ? formatMoney(summary.lineTwoValue) : '0.00'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-zinc-400">Mode</dt>
              <dd className="terminal-pill font-mono uppercase tracking-wide text-zinc-300">{form.side}</dd>
            </div>
          </dl>

          {scenario ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <article className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-400">If Target Hits ({scenario.targetPrice ? `₹ ${formatMoney(scenario.targetPrice)}` : '-'})</p>
                <p className="mt-2 font-mono text-sm text-zinc-300">Net: ₹ {formatMoney(scenario.targetNet)}</p>
                <p className={scenario.targetPnl !== null && scenario.targetPnl >= 0 ? 'font-mono text-lg font-semibold text-terminal-green' : 'font-mono text-lg font-semibold text-terminal-red'}>
                  P&L: {scenario.targetPnl === null ? '-' : `₹ ${formatMoney(scenario.targetPnl)}`}
                </p>
              </article>
              <article className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-400">If Stop Hits ({scenario.stopLoss ? `₹ ${formatMoney(scenario.stopLoss)}` : '-'})</p>
                <p className="mt-2 font-mono text-sm text-zinc-300">Net: ₹ {formatMoney(scenario.stopNet)}</p>
                <p className={scenario.stopPnl !== null && scenario.stopPnl >= 0 ? 'font-mono text-lg font-semibold text-terminal-green' : 'font-mono text-lg font-semibold text-terminal-red'}>
                  P&L: {scenario.stopPnl === null ? '-' : `₹ ${formatMoney(scenario.stopPnl)}`}
                </p>
              </article>
            </div>
          ) : null}
        </aside>
      </div>

      <section className="terminal-card overflow-hidden">
        <header className="border-b border-zinc-800 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-white">Charge Breakdown</h3>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-3 text-left sm:px-5">Charge</th>
                <th className="px-3 py-3 text-left sm:px-5">Rate</th>
                <th className="hidden px-3 py-3 text-left sm:table-cell sm:px-5">How it is charged</th>
                <th className="px-3 py-3 text-right sm:px-5">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {result?.breakdown.length ? (
                result.breakdown.map((line, index) => (
                  <tr key={`${line.charge}-${index}`} className="hover:bg-zinc-900/80">
                    <td className="px-3 py-3 text-zinc-300 sm:px-5">
                      <p>{line.charge}</p>
                      <p className="mt-1 text-[11px] text-zinc-500 sm:hidden">{explainCharge(line.charge)}</p>
                    </td>
                    <td className="px-3 py-3 text-zinc-400 font-mono sm:px-5">{formatRate(line.rate)}</td>
                    <td className="hidden px-3 py-3 text-zinc-500 sm:table-cell sm:px-5">{explainCharge(line.charge)}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-white sm:px-5">₹ {formatMoney(line.amount)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500 sm:px-5">
                    Run calculation to see detailed charges.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {scenario ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <article className="terminal-card overflow-hidden">
            <header className="border-b border-zinc-800 px-5 py-4">
              <h3 className="text-sm font-semibold text-white">Target Sell Charge Breakdown</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-800 text-sm">
                <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Charge</th>
                    <th className="px-4 py-3 text-left">Rate</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/80">
                  {scenario.targetBreakdown?.length ? (
                    scenario.targetBreakdown.map((line, index) => (
                      <tr key={`target-${line.charge}-${index}`}>
                        <td className="px-4 py-3 text-zinc-300">{line.charge}</td>
                        <td className="px-4 py-3 font-mono text-zinc-400">{formatRate(line.rate)}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-100">₹ {formatMoney(line.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                        Set a target price to see details.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="terminal-card overflow-hidden">
            <header className="border-b border-zinc-800 px-5 py-4">
              <h3 className="text-sm font-semibold text-white">Stop-Loss Sell Charge Breakdown</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-800 text-sm">
                <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Charge</th>
                    <th className="px-4 py-3 text-left">Rate</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/80">
                  {scenario.stopBreakdown?.length ? (
                    scenario.stopBreakdown.map((line, index) => (
                      <tr key={`stop-${line.charge}-${index}`}>
                        <td className="px-4 py-3 text-zinc-300">{line.charge}</td>
                        <td className="px-4 py-3 font-mono text-zinc-400">{formatRate(line.rate)}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-100">₹ {formatMoney(line.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                        Set a stop-loss price to see details.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card space-y-4 p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Risk Manager</p>
            <h3 className="mt-1 text-base font-semibold text-white">Position Sizing by Risk</h3>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Capital (NPR)</label>
              <input
                type="number"
                value={riskPlan.capital}
                onChange={(event) => setRiskPlan((old) => ({ ...old, capital: event.target.value }))}
                className="terminal-input font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Risk Per Trade (%)</label>
              <input
                type="number"
                value={riskPlan.riskPercent}
                onChange={(event) => setRiskPlan((old) => ({ ...old, riskPercent: event.target.value }))}
                className="terminal-input font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Entry Price</label>
              <input
                type="number"
                value={riskPlan.entryPrice}
                onChange={(event) => setRiskPlan((old) => ({ ...old, entryPrice: event.target.value }))}
                className="terminal-input font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Stop Price</label>
              <input
                type="number"
                value={riskPlan.stopPrice}
                onChange={(event) => setRiskPlan((old) => ({ ...old, stopPrice: event.target.value }))}
                className="terminal-input font-mono"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Target Price (optional)</label>
              <input
                type="number"
                value={riskPlan.targetPrice}
                onChange={(event) => setRiskPlan((old) => ({ ...old, targetPrice: event.target.value }))}
                className="terminal-input font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setRiskPlan((old) => ({
                  ...old,
                  entryPrice: form.price || old.entryPrice,
                  stopPrice: form.stopLoss || old.stopPrice,
                  targetPrice: form.targetPrice || old.targetPrice,
                }))
              }
              className="terminal-btn"
            >
              Sync From Calculator Inputs
            </button>
          </div>

          {riskSummary ? (
            <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 md:grid-cols-2">
              <p className="text-sm text-zinc-300">Max Risk Amount: <span className="font-mono text-zinc-100">₹ {formatMoney(riskSummary.maxRiskAmount)}</span></p>
              <p className="text-sm text-zinc-300">Risk Per Share: <span className="font-mono text-zinc-100">₹ {formatMoney(riskSummary.riskPerShare)}</span></p>
              <p className="text-sm text-zinc-300">Suggested Quantity: <span className="font-mono text-zinc-100">{riskSummary.suggestedQty}</span></p>
              <p className="text-sm text-zinc-300">Position Value: <span className="font-mono text-zinc-100">₹ {formatMoney(riskSummary.positionValue)}</span></p>
              <p className="text-sm text-zinc-300">Potential Loss: <span className="font-mono text-terminal-red">₹ {formatMoney(riskSummary.potentialLoss)}</span></p>
              <p className="text-sm text-zinc-300">Potential Gain: <span className="font-mono text-terminal-green">{riskSummary.potentialGain === null ? '-' : `₹ ${formatMoney(riskSummary.potentialGain)}`}</span></p>
              <p className="text-sm text-zinc-300">Capital Used: <span className="font-mono text-zinc-100">{riskSummary.capitalUsagePct.toFixed(2)}%</span></p>
              <p className="text-sm text-zinc-300">R:R Ratio: <span className="font-mono text-zinc-100">{riskSummary.riskRewardRatio === null ? '-' : riskSummary.riskRewardRatio.toFixed(2)}</span></p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Fill risk inputs to get position sizing suggestion.</p>
          )}

          {riskSummary?.warning ? <p className="text-sm font-medium text-terminal-red">{riskSummary.warning}</p> : null}
        </article>

        <article className="terminal-card space-y-4 p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Discipline</p>
            <h3 className="mt-1 text-base font-semibold text-white">Pre-Trade Checklist</h3>
          </header>

          <div className="space-y-2">
            {CHECKLIST_ITEMS.map((item) => (
              <label key={item.key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={checklist[item.key]}
                  onChange={(event) =>
                    setChecklist((old) => ({
                      ...old,
                      [item.key]: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-amber-400"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-black/50 p-3 text-sm">
            <p className="text-zinc-400">Checklist Completion</p>
            <p className="mt-1 font-mono text-lg text-white">
              {checklistCompleted}/{CHECKLIST_ITEMS.length}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Trade only when your process is complete and aligned with your risk plan.
            </p>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card space-y-4 p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Optional Reflection</p>
            <h3 className="mt-1 text-base font-semibold text-white">Execution Decision Diary</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Optional notes for why you buy/sell today. Notes now sync to your account across devices.
            </p>
            {!hasAuth ? (
              <p className="mt-2 text-xs text-terminal-amber">Login required for synced diary storage.</p>
            ) : null}
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Action</label>
              <select
                value={decisionDraft.side}
                onChange={(event) =>
                  setDecisionDraft((old) => ({
                    ...old,
                    side: event.target.value as ExecutionDecisionSide,
                  }))
                }
                className="terminal-input"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Symbol</label>
              <input
                value={decisionDraft.symbol}
                onChange={(event) => setDecisionDraft((old) => ({ ...old, symbol: event.target.value.toUpperCase() }))}
                className="terminal-input font-mono"
                placeholder="NABIL"
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Why this decision?</label>
              <textarea
                value={decisionDraft.reason}
                onChange={(event) => setDecisionDraft((old) => ({ ...old, reason: event.target.value }))}
                className="terminal-input min-h-[88px]"
                placeholder="Example: strong trend confirmation, volume pickup, and acceptable risk."
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Plan / invalidation (optional)</label>
              <textarea
                value={decisionDraft.plan}
                onChange={(event) => setDecisionDraft((old) => ({ ...old, plan: event.target.value }))}
                className="terminal-input min-h-[70px]"
                placeholder="Entry/exit reference, risk line, what invalidates the setup."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Confidence (1-5)</label>
              <select
                value={decisionDraft.confidence}
                onChange={(event) => setDecisionDraft((old) => ({ ...old, confidence: event.target.value }))}
                className="terminal-input"
              >
                <option value="1">1 - Low</option>
                <option value="2">2</option>
                <option value="3">3 - Medium</option>
                <option value="4">4</option>
                <option value="5">5 - High</option>
              </select>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <button type="button" onClick={syncDraftFromCalculator} className="terminal-btn">
                Sync From Calculator
              </button>
              <button type="button" onClick={addDecisionEntry} className="terminal-btn-primary" disabled={decisionLoading || !hasAuth}>
                {decisionLoading ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>

          {decisionError ? <p className="text-sm text-terminal-red">{decisionError}</p> : null}
        </article>

        <article className="terminal-card space-y-4 p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Daily Review</p>
            <h3 className="mt-1 text-base font-semibold text-white">Decision Evaluation Board</h3>
          </header>

          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Logged Today</p>
              <p className="mt-2 font-mono text-lg text-white">{decisionSummary.totalToday}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Reviewed</p>
              <p className="mt-2 font-mono text-lg text-terminal-green">{decisionSummary.reviewedToday}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Pending</p>
              <p className="mt-2 font-mono text-lg text-terminal-amber">{decisionSummary.pendingToday}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Correct Rate</p>
              <p className="mt-2 font-mono text-lg text-cyan-200">{decisionSummary.hitRate.toFixed(1)}%</p>
            </div>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {decisionSummary.latest.length ? (
              decisionSummary.latest.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm text-zinc-100">
                      {entry.symbol} • {entry.side} • C{entry.confidence}
                    </p>
                    <p className="text-xs text-zinc-500">{new Date(entry.createdAt).toLocaleTimeString()}</p>
                  </div>
                  <p className="mt-2 text-sm text-zinc-300">{entry.reason}</p>
                  {entry.plan ? <p className="mt-1 text-xs text-zinc-500">Plan: {entry.plan}</p> : null}

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <select
                      value={entry.outcome}
                      onChange={(event) =>
                        patchDecisionEntry(entry.id, {
                          outcome: event.target.value as ExecutionDecisionOutcome,
                        })
                      }
                      className="terminal-input"
                    >
                      <option value="PENDING">Pending Review</option>
                      <option value="CORRECT">Correct</option>
                      <option value="PARTIAL">Partially Correct</option>
                      <option value="WRONG">Wrong</option>
                      <option value="SKIPPED">Skipped Trade</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => markDecisionReviewed(entry.id, entry.outcome)}
                      className="terminal-btn"
                    >
                      {entry.outcome === 'PENDING' ? 'Keep Pending' : 'Mark Reviewed'}
                    </button>
                  </div>

                  <textarea
                    value={entry.reviewNote ?? ''}
                    onChange={(event) =>
                      patchDecisionEntry(entry.id, {
                        reviewNote: event.target.value,
                      })
                    }
                    className="terminal-input mt-2 min-h-[70px]"
                    placeholder="What did you learn from this decision today?"
                  />

                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-[11px] text-zinc-500">
                      Reviewed: {entry.reviewedAt ? new Date(entry.reviewedAt).toLocaleString() : 'Not yet'}
                    </p>
                    <button type="button" onClick={() => deleteDecisionEntry(entry.id)} className="terminal-btn text-xs">
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No decision notes for today yet. Add one from the optional diary section.</p>
            )}
          </div>
        </article>
      </section>
    </section>
  );
}
