import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchIndicators,
  fetchIndices,
  fetchPortfolio,
  fetchSignal,
  fetchWatchlist,
} from '../../lib/api';
import {
  AuthUser,
  HoldingRow,
  IndexApiRow,
  PortfolioResponse,
  TradingSignalResponse,
  WatchlistApiRow,
} from '../../types';

const MARKET_POLL_INTERVAL = 45_000;
const SIGNAL_UNIVERSE_SIZE = 120;
const SIGNAL_FETCH_BATCH_SIZE = 8;

type AlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

interface AlertItem {
  id: string;
  symbol: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
  createdAt: string;
}

interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  reason: string;
}

interface BacktestResult {
  initialCapital: number;
  finalCapital: number;
  netPnl: number;
  returnPct: number;
  tradeCount: number;
  winRate: number;
  profitFactor: number | null;
  expectancy: number;
  maxDrawdownPct: number;
  trades: BacktestTrade[];
}

interface RiskLimits {
  maxSectorPct: string;
  maxSinglePositionPct: string;
  maxStopRiskPct: string;
}

interface HoldingRiskRow {
  holding: HoldingRow;
  currentValue: number;
  allocationPct: number;
  stopRiskAmount: number | null;
}

interface SectorExposureRow {
  sector: string;
  value: number;
  allocationPct: number;
}

function formatMoney(value: number | null): string {
  if (value === null) return '-';

  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null, digits = 2): string {
  if (value === null) return '-';
  return `${value.toFixed(digits)}%`;
}

function severityClasses(severity: AlertSeverity): string {
  if (severity === 'HIGH') return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  if (severity === 'MEDIUM') return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200';
}

function mergeAlerts(existing: AlertItem[], incoming: AlertItem[]): AlertItem[] {
  const seen = new Set<string>();
  const merged = [...incoming, ...existing].filter((item) => {
    const key = `${item.symbol}|${item.title}|${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return merged.slice(0, 120);
}

async function fetchSignalWithRetry(symbol: string): Promise<TradingSignalResponse | null> {
  try {
    return await fetchSignal(symbol);
  } catch {
    try {
      return await fetchSignal(symbol);
    } catch {
      return null;
    }
  }
}

async function fetchSignalsBySymbol(symbols: string[]): Promise<Record<string, TradingSignalResponse | null>> {
  const signalMap: Record<string, TradingSignalResponse | null> = {};

  for (let index = 0; index < symbols.length; index += SIGNAL_FETCH_BATCH_SIZE) {
    const batch = symbols.slice(index, index + SIGNAL_FETCH_BATCH_SIZE);
    const entries = await Promise.all(
      batch.map(async (symbol) => {
        const signal = await fetchSignalWithRetry(symbol);
        return [symbol, signal] as const;
      }),
    );

    for (const [symbol, signal] of entries) {
      signalMap[symbol] = signal;
    }
  }

  return signalMap;
}

function computeMarketBias(indices: IndexApiRow[], watchlist: WatchlistApiRow[]): {
  label: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  breadthRatio: number;
  gainers: number;
  losers: number;
  nepseChangePct: number;
} {
  const nepse = indices.find((row) => row.indexName.toLowerCase().includes('nepse'));
  const nepseChangePct = nepse?.change_pct ?? 0;

  const gainers = watchlist.filter((row) => (row.change_pct ?? 0) > 0).length;
  const losers = watchlist.filter((row) => (row.change_pct ?? 0) < 0).length;
  const breadthRatio = losers > 0 ? gainers / losers : gainers > 0 ? gainers : 1;

  if (nepseChangePct >= 0.8 && breadthRatio >= 1.1) {
    return { label: 'BULLISH', breadthRatio, gainers, losers, nepseChangePct };
  }

  if (nepseChangePct <= -0.8 && breadthRatio <= 0.9) {
    return { label: 'BEARISH', breadthRatio, gainers, losers, nepseChangePct };
  }

  return { label: 'NEUTRAL', breadthRatio, gainers, losers, nepseChangePct };
}

export function EdgeSuiteTerminalPage({ user }: { user: AuthUser | null }) {
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [indices, setIndices] = useState<IndexApiRow[]>([]);
  const [signalsBySymbol, setSignalsBySymbol] = useState<Record<string, TradingSignalResponse>>({});
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [interval, setIntervalValue] = useState<'1m' | '5m' | '15m' | '1h' | '1d'>('1h');
  const [initialCapital, setInitialCapital] = useState('500000');
  const [riskPerTradePct, setRiskPerTradePct] = useState('1');
  const [stopLossPct, setStopLossPct] = useState('4');
  const [targetPct, setTargetPct] = useState('8');
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState('');

  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState('');
  const [riskLimits, setRiskLimits] = useState<RiskLimits>({
    maxSectorPct: '35',
    maxSinglePositionPct: '12',
    maxStopRiskPct: '6',
  });

  const previousSignalsRef = useRef<Record<string, TradingSignalResponse>>({});
  const previousWatchlistRef = useRef<Map<string, WatchlistApiRow>>(new Map());

  const loadPortfolioRisk = useCallback(async () => {
    if (!user) {
      setPortfolio(null);
      return;
    }

    setRiskLoading(true);
    setRiskError('');

    try {
      const data = await fetchPortfolio();
      setPortfolio(data);
    } catch (error) {
      setPortfolio(null);
      setRiskError(error instanceof Error ? error.message : 'Failed to load portfolio risk data.');
    } finally {
      setRiskLoading(false);
    }
  }, [user]);

  const loadMarketData = useCallback(async () => {
    setLoadingMarket(true);

    try {
      const [watchlistRows, indexRows] = await Promise.all([fetchWatchlist(), fetchIndices()]);

      const universe = [...watchlistRows]
        .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
        .slice(0, SIGNAL_UNIVERSE_SIZE);

      const fetchedSignals = await fetchSignalsBySymbol(universe.map((row) => row.symbol));

      const signalMap: Record<string, TradingSignalResponse> = {};
      for (const row of universe) {
        const latestSignal = fetchedSignals[row.symbol];
        const previousSignal = previousSignalsRef.current[row.symbol];
        const resolvedSignal = latestSignal ?? previousSignal ?? null;

        if (resolvedSignal) {
          signalMap[row.symbol] = resolvedSignal;
        }
      }

      if (!selectedSymbol) {
        setSelectedSymbol(universe[0]?.symbol ?? '');
      }

      const incomingAlerts: AlertItem[] = [];
      const now = new Date();
      const minuteKey = Math.floor(now.getTime() / 60_000);

      for (const row of universe) {
        const signal = signalMap[row.symbol];
        const previousSignal = previousSignalsRef.current[row.symbol];
        const previousRow = previousWatchlistRef.current.get(row.symbol);

        if (signal && previousSignal && signal.signal !== previousSignal.signal) {
          incomingAlerts.push({
            id: `flip-${row.symbol}-${minuteKey}`,
            symbol: row.symbol,
            title: 'Signal Flip',
            detail: `Signal changed from ${previousSignal.signal} to ${signal.signal}`,
            severity: signal.signal === 'HOLD' ? 'LOW' : 'HIGH',
            createdAt: now.toISOString(),
          });
        }

        if (
          previousRow?.turnover !== null &&
          previousRow?.turnover !== undefined &&
          row.turnover !== null &&
          row.turnover !== undefined &&
          previousRow.turnover > 0 &&
          row.turnover > previousRow.turnover * 1.8
        ) {
          incomingAlerts.push({
            id: `turnover-${row.symbol}-${minuteKey}`,
            symbol: row.symbol,
            title: 'Turnover Spike',
            detail: `Turnover expanded to ₹ ${formatMoney(row.turnover)} (vs prior snapshot).`,
            severity: 'MEDIUM',
            createdAt: now.toISOString(),
          });
        }

        if (row.change_pct !== null && Math.abs(row.change_pct) >= 5.5) {
          incomingAlerts.push({
            id: `vol-${row.symbol}-${minuteKey}`,
            symbol: row.symbol,
            title: 'Volatility Alert',
            detail: `Price moved ${formatPercent(row.change_pct)}. Size position carefully.`,
            severity: Math.abs(row.change_pct) >= 8 ? 'HIGH' : 'MEDIUM',
            createdAt: now.toISOString(),
          });
        }
      }

      if (portfolio?.holdings.length) {
        const rowMap = new Map<string, WatchlistApiRow>(watchlistRows.map((row) => [row.symbol, row]));

        for (const holding of portfolio.holdings) {
          const currentPrice = holding.currentPrice ?? rowMap.get(holding.symbol)?.ltp ?? null;
          if (currentPrice === null) continue;

          if (holding.stopLoss !== null && currentPrice <= holding.stopLoss * 1.01) {
            incomingAlerts.push({
              id: `stop-${holding.symbol}-${minuteKey}`,
              symbol: holding.symbol,
              title: 'Stop-Loss Near',
              detail: `Current price is near/under stop (${formatMoney(holding.stopLoss)}).`,
              severity: 'HIGH',
              createdAt: now.toISOString(),
            });
          }

          if (holding.targetPrice !== null && currentPrice >= holding.targetPrice * 0.99) {
            incomingAlerts.push({
              id: `target-${holding.symbol}-${minuteKey}`,
              symbol: holding.symbol,
              title: 'Target Near',
              detail: `Current price is near/above target (${formatMoney(holding.targetPrice)}).`,
              severity: 'MEDIUM',
              createdAt: now.toISOString(),
            });
          }
        }
      }

      setWatchlist(watchlistRows);
      setIndices(indexRows);
      setSignalsBySymbol(signalMap);
      setAlerts((previous) => mergeAlerts(previous, incomingAlerts));
      setLastRefreshedAt(now.toISOString());
      setMarketError('');

      previousSignalsRef.current = signalMap;
      previousWatchlistRef.current = new Map(watchlistRows.map((row) => [row.symbol, row]));
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : 'Failed to refresh market intelligence.');
    } finally {
      setLoadingMarket(false);
    }
  }, [portfolio?.holdings, selectedSymbol]);

  useEffect(() => {
    void loadMarketData();
    const timer = setInterval(() => {
      void loadMarketData();
    }, MARKET_POLL_INTERVAL);

    return () => clearInterval(timer);
  }, [loadMarketData]);

  useEffect(() => {
    void loadPortfolioRisk();
  }, [loadPortfolioRisk]);

  const runBacktest = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      setBacktestLoading(true);
      setBacktestError('');

      try {
        const capital = Number(initialCapital);
        const riskPct = Number(riskPerTradePct);
        const stopPct = Number(stopLossPct);
        const tpPct = Number(targetPct);

        if (!selectedSymbol) {
          throw new Error('Select a symbol first.');
        }

        if (
          !Number.isFinite(capital) ||
          !Number.isFinite(riskPct) ||
          !Number.isFinite(stopPct) ||
          !Number.isFinite(tpPct) ||
          capital <= 0 ||
          riskPct <= 0 ||
          stopPct <= 0 ||
          tpPct <= 0
        ) {
          throw new Error('Backtest inputs must be positive numbers.');
        }

        const indicators = await fetchIndicators(selectedSymbol, interval, 360);
        const candles = indicators.candles;
        if (candles.length < 60) {
          throw new Error('Not enough candles for backtest. Choose a symbol with deeper history.');
        }

        let equity = capital;
        let peakEquity = capital;
        let maxDrawdownPct = 0;
        const trades: BacktestTrade[] = [];

        let openTrade: {
          entryPrice: number;
          qty: number;
          entryTime: string;
          stopPrice: number;
          targetPrice: number;
        } | null = null;

        for (let i = 30; i < candles.length; i += 1) {
          const candle = candles[i];
          const previous = candles[i - 1];
          const ema = indicators.ema20[i]?.value ?? null;
          const rsi = indicators.rsi14[i]?.value ?? null;

          if (openTrade) {
            let exitPrice = candle.c;
            let reason = '';

            if (candle.l <= openTrade.stopPrice) {
              exitPrice = openTrade.stopPrice;
              reason = 'Stop';
            } else if (candle.h >= openTrade.targetPrice) {
              exitPrice = openTrade.targetPrice;
              reason = 'Target';
            } else if (ema !== null && candle.c < ema) {
              exitPrice = candle.c;
              reason = 'Trend break';
            }

            if (reason) {
              const pnl = (exitPrice - openTrade.entryPrice) * openTrade.qty;
              equity += pnl;

              peakEquity = Math.max(peakEquity, equity);
              const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
              maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);

              trades.push({
                entryTime: openTrade.entryTime,
                exitTime: candle.t,
                entryPrice: openTrade.entryPrice,
                exitPrice,
                qty: openTrade.qty,
                pnl,
                reason,
              });

              openTrade = null;
            }
          }

          if (!openTrade && ema !== null && rsi !== null) {
            const entrySignal = candle.c > ema && candle.c >= previous.c && rsi >= 40 && rsi <= 68;
            if (!entrySignal) continue;

            const stopPrice = candle.c * (1 - stopPct / 100);
            const targetPrice = candle.c * (1 + tpPct / 100);
            const riskPerShare = candle.c - stopPrice;
            if (riskPerShare <= 0) continue;

            const riskBudget = equity * (riskPct / 100);
            const qty = Math.floor(riskBudget / riskPerShare);
            if (qty < 1) continue;

            openTrade = {
              entryPrice: candle.c,
              qty,
              entryTime: candle.t,
              stopPrice,
              targetPrice,
            };
          }
        }

        if (openTrade) {
          const lastCandle = candles[candles.length - 1];
          const pnl = (lastCandle.c - openTrade.entryPrice) * openTrade.qty;
          equity += pnl;

          peakEquity = Math.max(peakEquity, equity);
          const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
          maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);

          trades.push({
            entryTime: openTrade.entryTime,
            exitTime: lastCandle.t,
            entryPrice: openTrade.entryPrice,
            exitPrice: lastCandle.c,
            qty: openTrade.qty,
            pnl,
            reason: 'EOD close',
          });
        }

        const wins = trades.filter((trade) => trade.pnl > 0);
        const losses = trades.filter((trade) => trade.pnl < 0);
        const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0);
        const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));

        const netPnl = equity - capital;
        const tradeCount = trades.length;

        setBacktestResult({
          initialCapital: capital,
          finalCapital: equity,
          netPnl,
          returnPct: capital > 0 ? (netPnl / capital) * 100 : 0,
          tradeCount,
          winRate: tradeCount > 0 ? (wins.length / tradeCount) * 100 : 0,
          profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : null,
          expectancy: tradeCount > 0 ? netPnl / tradeCount : 0,
          maxDrawdownPct,
          trades: [...trades].reverse().slice(0, 18),
        });
      } catch (error) {
        setBacktestResult(null);
        setBacktestError(error instanceof Error ? error.message : 'Backtest failed.');
      } finally {
        setBacktestLoading(false);
      }
    },
    [initialCapital, interval, riskPerTradePct, selectedSymbol, stopLossPct, targetPct],
  );

  const riskModel = useMemo(() => {
    if (!portfolio) {
      return null;
    }

    const maxSectorPct = Number(riskLimits.maxSectorPct);
    const maxSinglePositionPct = Number(riskLimits.maxSinglePositionPct);
    const maxStopRiskPct = Number(riskLimits.maxStopRiskPct);

    if (
      !Number.isFinite(maxSectorPct) ||
      !Number.isFinite(maxSinglePositionPct) ||
      !Number.isFinite(maxStopRiskPct) ||
      maxSectorPct <= 0 ||
      maxSinglePositionPct <= 0 ||
      maxStopRiskPct <= 0
    ) {
      return {
        holdings: [] as HoldingRiskRow[],
        sectors: [] as SectorExposureRow[],
        warnings: ['Risk limits must be valid positive percentages.'],
        stopRiskPct: 0,
      };
    }

    const baseValue =
      portfolio.summary.currentValue > 0
        ? portfolio.summary.currentValue
        : portfolio.summary.investedCost;

    if (baseValue <= 0) {
      return {
        holdings: [] as HoldingRiskRow[],
        sectors: [] as SectorExposureRow[],
        warnings: ['Portfolio base value is zero. Add holdings to assess risk.'],
        stopRiskPct: 0,
      };
    }

    const holdings: HoldingRiskRow[] = portfolio.holdings.map((holding) => {
      const currentValue =
        holding.currentValue ??
        (holding.currentPrice !== null ? holding.currentPrice * holding.qty : holding.buyPrice * holding.qty);

      const stopRiskAmount =
        holding.stopLoss !== null && holding.currentPrice !== null
          ? Math.max(holding.currentPrice - holding.stopLoss, 0) * holding.qty
          : null;

      return {
        holding,
        currentValue,
        allocationPct: (currentValue / baseValue) * 100,
        stopRiskAmount,
      };
    });

    const sectorMap = new Map<string, number>();
    for (const row of holdings) {
      const sector = row.holding.sector ?? 'Unclassified';
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + row.currentValue);
    }

    const sectors: SectorExposureRow[] = [...sectorMap.entries()]
      .map(([sector, value]) => ({
        sector,
        value,
        allocationPct: (value / baseValue) * 100,
      }))
      .sort((a, b) => b.value - a.value);

    const totalStopRisk = holdings.reduce((sum, row) => sum + (row.stopRiskAmount ?? 0), 0);
    const stopRiskPct = (totalStopRisk / baseValue) * 100;

    const warnings: string[] = [];

    for (const row of holdings) {
      if (row.allocationPct > maxSinglePositionPct) {
        warnings.push(
          `${row.holding.symbol} allocation ${formatPercent(row.allocationPct)} exceeds single-position cap ${formatPercent(maxSinglePositionPct)}.`,
        );
      }

      if (row.holding.stopLoss === null) {
        warnings.push(`${row.holding.symbol} has no stop-loss defined.`);
      }
    }

    for (const sector of sectors) {
      if (sector.allocationPct > maxSectorPct) {
        warnings.push(
          `${sector.sector} exposure ${formatPercent(sector.allocationPct)} exceeds sector cap ${formatPercent(maxSectorPct)}.`,
        );
      }
    }

    if (stopRiskPct > maxStopRiskPct) {
      warnings.push(
        `Portfolio stop-risk ${formatPercent(stopRiskPct)} exceeds cap ${formatPercent(maxStopRiskPct)}.`,
      );
    }

    return {
      holdings: holdings.sort((a, b) => b.allocationPct - a.allocationPct),
      sectors,
      warnings,
      stopRiskPct,
    };
  }, [portfolio, riskLimits.maxSectorPct, riskLimits.maxSinglePositionPct, riskLimits.maxStopRiskPct]);

  const playbook = useMemo(() => {
    const bias = computeMarketBias(indices, watchlist);

    const topUniverse = [...watchlist]
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, SIGNAL_UNIVERSE_SIZE)
      .map((row) => ({
        ...row,
        signal: signalsBySymbol[row.symbol],
      }));

    const actionableUniverse = topUniverse.filter(
      (row): row is WatchlistApiRow & { signal: TradingSignalResponse } => Boolean(row.signal),
    );

    const rankedForBuy = [...actionableUniverse].sort(
      (a, b) =>
        (b.signal.buyScore - b.signal.sellScore) - (a.signal.buyScore - a.signal.sellScore) ||
        b.signal.strength - a.signal.strength ||
        (b.turnover ?? 0) - (a.turnover ?? 0),
    );

    const rankedForSell = [...actionableUniverse].sort(
      (a, b) =>
        (b.signal.sellScore - b.signal.buyScore) - (a.signal.sellScore - a.signal.buyScore) ||
        b.signal.strength - a.signal.strength ||
        (b.turnover ?? 0) - (a.turnover ?? 0),
    );

    const buyPrimary = rankedForBuy.filter((row) => row.signal.signal === 'BUY').slice(0, 5);
    const buyFallback = rankedForBuy
      .filter(
        (row) =>
          row.signal.signal !== 'BUY' &&
          row.signal.buyScore > row.signal.sellScore &&
          !buyPrimary.some((picked) => picked.symbol === row.symbol),
      )
      .slice(0, Math.max(0, 5 - buyPrimary.length));
    const topBuy = [...buyPrimary, ...buyFallback];

    const sellPrimary = rankedForSell.filter((row) => row.signal.signal === 'SELL').slice(0, 5);
    const sellFallback = rankedForSell
      .filter(
        (row) =>
          row.signal.signal !== 'SELL' &&
          row.signal.sellScore > row.signal.buyScore &&
          !sellPrimary.some((picked) => picked.symbol === row.symbol),
      )
      .slice(0, Math.max(0, 5 - sellPrimary.length));
    const topSell = [...sellPrimary, ...sellFallback];

    const avoid = topUniverse
      .filter(
        (row) =>
          (row.change_pct !== null && Math.abs(row.change_pct) >= 7) ||
          ((row.turnover ?? 0) < 2_000_000 && Math.abs(row.change_pct ?? 0) >= 4),
      )
      .slice(0, 5);

    const checklist: string[] = [];

    if (bias.label === 'BULLISH') {
      checklist.push('Prioritize long setups with strong turnover and defined stops.');
      checklist.push('Avoid chasing symbols already extended above 7% intraday move.');
    } else if (bias.label === 'BEARISH') {
      checklist.push('Cut weak names early and reduce position size by 25-40%.');
      checklist.push('Take only A+ setups; skip marginal breakouts.');
    } else {
      checklist.push('Trade lighter and demand clear confirmations before entries.');
      checklist.push('Prefer range edges and quick risk-defined exits.');
    }

    checklist.push('Keep per-trade risk capped at 1-2% of capital.');
    checklist.push('Log setup quality before entry and review after close.');

    return {
      bias,
      topBuy,
      topSell,
      avoid,
      checklist,
    };
  }, [indices, signalsBySymbol, watchlist]);

  const alertStats = useMemo(() => {
    return {
      high: alerts.filter((item) => item.severity === 'HIGH').length,
      medium: alerts.filter((item) => item.severity === 'MEDIUM').length,
      low: alerts.filter((item) => item.severity === 'LOW').length,
    };
  }, [alerts]);

  const universeClassification = useMemo(() => {
    const sectorDistribution = new Map<string, number>();
    const unclassifiedSymbols: string[] = [];

    for (const row of watchlist) {
      const normalizedSector = row.sector?.trim() ?? '';
      if (!normalizedSector) {
        unclassifiedSymbols.push(row.symbol);
        continue;
      }

      sectorDistribution.set(normalizedSector, (sectorDistribution.get(normalizedSector) ?? 0) + 1);
    }

    const classified = watchlist.length - unclassifiedSymbols.length;

    return {
      total: watchlist.length,
      classified,
      unclassified: unclassifiedSymbols.length,
      coveragePct: watchlist.length > 0 ? (classified / watchlist.length) * 100 : 0,
      topSectors: [...sectorDistribution.entries()]
        .map(([sector, count]) => ({ sector, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      unclassifiedSymbols: unclassifiedSymbols.slice(0, 20),
    };
  }, [watchlist]);

  const signalCoverage = useMemo(() => {
    const ranked = [...watchlist]
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, SIGNAL_UNIVERSE_SIZE)
      .map((row) => ({ row, signal: signalsBySymbol[row.symbol] }))
      .filter(
        (entry): entry is { row: WatchlistApiRow; signal: TradingSignalResponse } => Boolean(entry.signal),
      );

    const buyCount = ranked.filter((entry) => entry.signal.signal === 'BUY').length;
    const sellCount = ranked.filter((entry) => entry.signal.signal === 'SELL').length;
    const holdCount = ranked.filter((entry) => entry.signal.signal === 'HOLD').length;

    const topConviction = [...ranked]
      .sort(
        (a, b) =>
          b.signal.strength - a.signal.strength ||
          Math.abs(b.signal.buyScore - b.signal.sellScore) -
            Math.abs(a.signal.buyScore - a.signal.sellScore) ||
          (b.row.turnover ?? 0) - (a.row.turnover ?? 0),
      )
      .slice(0, 8);

    return {
      coveredCount: ranked.length,
      coveragePct: watchlist.length > 0 ? (ranked.length / watchlist.length) * 100 : 0,
      buyCount,
      sellCount,
      holdCount,
      topConviction,
    };
  }, [signalsBySymbol, watchlist]);

  return (
    <section className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-terminal-border/70 bg-terminal-panel/80 p-6 shadow-terminal">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute -bottom-10 left-1/3 h-40 w-40 rounded-full bg-terminal-amber/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.26em] text-cyan-300">Trader Edge Suite</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Alerts, Backtests, Risk Controls, Daily Playbook</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-300">
            One command center for actionable alerts, quantified strategy testing, portfolio guardrails, and market playbook planning.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void loadMarketData()} className="terminal-btn-primary">
              {loadingMarket ? 'Refreshing intelligence...' : 'Refresh Intelligence'}
            </button>
            <button type="button" onClick={() => void loadPortfolioRisk()} className="terminal-btn">
              {riskLoading ? 'Loading risk...' : 'Refresh Portfolio Risk'}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Last refresh: {lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleString() : 'Not refreshed yet'}
          </p>
        </div>
      </header>

      {marketError ? <p className="text-sm font-medium text-terminal-red">{marketError}</p> : null}
      {riskError ? <p className="text-sm font-medium text-terminal-red">{riskError}</p> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">High Priority Alerts</p>
          <p className="mt-2 font-mono text-2xl font-bold text-terminal-red">{alertStats.high}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Medium Alerts</p>
          <p className="mt-2 font-mono text-2xl font-bold text-terminal-amber">{alertStats.medium}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Low Alerts</p>
          <p className="mt-2 font-mono text-2xl font-bold text-cyan-300">{alertStats.low}</p>
        </article>
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Tracked Universe</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white">{universeClassification.total}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Classified {universeClassification.classified} | Unclassified {universeClassification.unclassified}
          </p>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-base font-semibold text-white">Universe Classification Coverage</h2>
            <p className="mt-1 text-xs text-zinc-500">Sector-classified companies and remaining symbols still awaiting profile metadata.</p>
          </header>

          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Coverage</p>
                <p className="mt-2 font-mono text-lg font-bold text-cyan-200">{formatPercent(universeClassification.coveragePct)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Classified</p>
                <p className="mt-2 font-mono text-lg font-bold text-terminal-green">{universeClassification.classified}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Unclassified</p>
                <p className="mt-2 font-mono text-lg font-bold text-terminal-amber">{universeClassification.unclassified}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Top Sector Distribution</p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                  {universeClassification.topSectors.length ? (
                    universeClassification.topSectors.map((sector) => (
                      <li key={sector.sector} className="flex items-center justify-between gap-3">
                        <span>{sector.sector}</span>
                        <span className="font-mono text-zinc-100">{sector.count}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-zinc-500">No classified sector rows available yet.</li>
                  )}
                </ul>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Unclassified Symbols</p>
                {universeClassification.unclassifiedSymbols.length ? (
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                    {universeClassification.unclassifiedSymbols.join(', ')}
                    {universeClassification.unclassified > universeClassification.unclassifiedSymbols.length ? ' ...' : ''}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-terminal-green">All tracked symbols are sector-classified.</p>
                )}
              </div>
            </div>
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-base font-semibold text-white">Signal Radar Coverage</h2>
            <p className="mt-1 text-xs text-zinc-500">Merged suite snapshot of BUY, SELL, HOLD states with top conviction symbols.</p>
          </header>

          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 md:col-span-1">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Signal Coverage</p>
                <p className="mt-2 font-mono text-lg font-bold text-cyan-200">{formatPercent(signalCoverage.coveragePct)}</p>
                <p className="mt-1 text-xs text-zinc-500">{signalCoverage.coveredCount} / {watchlist.length}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">BUY</p>
                <p className="mt-2 font-mono text-lg font-bold text-terminal-green">{signalCoverage.buyCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">SELL</p>
                <p className="mt-2 font-mono text-lg font-bold text-terminal-red">{signalCoverage.sellCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">HOLD</p>
                <p className="mt-2 font-mono text-lg font-bold text-terminal-amber">{signalCoverage.holdCount}</p>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Top Conviction Signals</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {signalCoverage.topConviction.length ? (
                  signalCoverage.topConviction.map((entry) => (
                    <li key={`conviction-${entry.row.symbol}`} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-zinc-100">{entry.row.symbol}</span>
                      <span className="text-xs text-zinc-400">
                        {entry.signal.signal} S{entry.signal.strength} ({entry.signal.buyScore}/{entry.signal.sellScore})
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-zinc-500">Signal engine is warming up. Refresh in a few seconds.</li>
                )}
              </ul>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-base font-semibold text-white">Smart Alerts Engine</h2>
            <p className="mt-1 text-xs text-zinc-500">Signal flips, volatility expansion, turnover spikes, and portfolio stop/target proximity.</p>
          </header>
          <div className="max-h-[440px] space-y-3 overflow-y-auto p-4">
            {alerts.length ? (
              alerts.map((alert) => (
                <div key={alert.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-white">{alert.symbol}</span>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityClasses(alert.severity)}`}>
                      {alert.severity}
                    </span>
                    <span className="text-xs text-zinc-500">{new Date(alert.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-zinc-200">{alert.title}</p>
                  <p className="mt-1 text-xs text-zinc-400">{alert.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No alerts generated yet. Refresh and wait for market moves.</p>
            )}
          </div>
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-base font-semibold text-white">Daily Playbook</h2>
            <p className="mt-1 text-xs text-zinc-500">Auto-generated market bias, setups, avoid list, and process checklist.</p>
          </header>

          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Market Bias</p>
                <p className={
                  playbook.bias.label === 'BULLISH'
                    ? 'mt-2 font-mono text-lg font-bold text-terminal-green'
                    : playbook.bias.label === 'BEARISH'
                      ? 'mt-2 font-mono text-lg font-bold text-terminal-red'
                      : 'mt-2 font-mono text-lg font-bold text-terminal-amber'
                }>
                  {playbook.bias.label}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">NEPSE Change</p>
                <p className="mt-2 font-mono text-lg font-bold text-white">{formatPercent(playbook.bias.nepseChangePct)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Breadth (G/L)</p>
                <p className="mt-2 font-mono text-lg font-bold text-white">{playbook.bias.gainers}/{playbook.bias.losers}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-terminal-green">Top BUY Setups</p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                  {playbook.topBuy.length ? (
                    playbook.topBuy.map((row) => (
                      <li key={`buy-${row.symbol}`} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-zinc-100">{row.symbol}</span>
                        <span className="text-xs text-zinc-400">
                          {row.signal?.signal ?? 'HOLD'} S{row.signal?.strength ?? 0} | T ₹ {formatMoney(row.turnover ?? 0)}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="text-zinc-500">No strong BUY setups right now.</li>
                  )}
                </ul>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-terminal-red">Top SELL Setups</p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                  {playbook.topSell.length ? (
                    playbook.topSell.map((row) => (
                      <li key={`sell-${row.symbol}`} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-zinc-100">{row.symbol}</span>
                        <span className="text-xs text-zinc-400">
                          {row.signal?.signal ?? 'HOLD'} S{row.signal?.strength ?? 0} | T ₹ {formatMoney(row.turnover ?? 0)}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="text-zinc-500">No strong SELL setups right now.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-terminal-amber">Avoid List</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {playbook.avoid.length ? (
                  playbook.avoid.map((row) => (
                    <li key={`avoid-${row.symbol}`} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-zinc-100">{row.symbol}</span>
                      <span className="text-xs text-zinc-400">{formatPercent(row.change_pct)}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-zinc-500">No symbols flagged for avoid list now.</li>
                )}
              </ul>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs uppercase tracking-wide text-cyan-300">Execution Checklist</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {playbook.checklist.map((item, index) => (
                  <li key={`check-${index}`}>
                    {index + 1}. {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-base font-semibold text-white">Strategy Backtest Lab</h2>
            <p className="mt-1 text-xs text-zinc-500">Rule: EMA20 trend alignment with RSI filter plus risk-based position sizing and stop/target exits.</p>
          </header>

          <form onSubmit={(event) => void runBacktest(event)} className="grid gap-3 p-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-zinc-400">Symbol</label>
              <select
                value={selectedSymbol}
                onChange={(event) => setSelectedSymbol(event.target.value)}
                className="terminal-input"
              >
                <option value="">Select symbol</option>
                {watchlist.map((row) => (
                  <option key={row.symbol} value={row.symbol}>
                    {row.symbol}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-zinc-400">Interval</label>
              <select
                value={interval}
                onChange={(event) => setIntervalValue(event.target.value as '1m' | '5m' | '15m' | '1h' | '1d')}
                className="terminal-input"
              >
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="1d">1d</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-zinc-400">Initial Capital</label>
              <input value={initialCapital} onChange={(event) => setInitialCapital(event.target.value)} className="terminal-input font-mono" type="number" />
            </div>

            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-zinc-400">Risk Per Trade (%)</label>
              <input value={riskPerTradePct} onChange={(event) => setRiskPerTradePct(event.target.value)} className="terminal-input font-mono" type="number" />
            </div>

            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-zinc-400">Stop Loss (%)</label>
              <input value={stopLossPct} onChange={(event) => setStopLossPct(event.target.value)} className="terminal-input font-mono" type="number" />
            </div>

            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-zinc-400">Target (%)</label>
              <input value={targetPct} onChange={(event) => setTargetPct(event.target.value)} className="terminal-input font-mono" type="number" />
            </div>

            <button type="submit" className="terminal-btn-primary md:col-span-2">
              {backtestLoading ? 'Running backtest...' : 'Run Backtest'}
            </button>
          </form>

          {backtestError ? <p className="px-4 pb-2 text-sm font-medium text-terminal-red">{backtestError}</p> : null}

          {backtestResult ? (
            <div className="space-y-4 border-t border-zinc-800 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Net P&L</p>
                  <p className={backtestResult.netPnl >= 0 ? 'mt-1 font-mono text-lg font-bold text-terminal-green' : 'mt-1 font-mono text-lg font-bold text-terminal-red'}>
                    ₹ {formatMoney(backtestResult.netPnl)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Return</p>
                  <p className="mt-1 font-mono text-lg font-bold text-white">{formatPercent(backtestResult.returnPct)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Win Rate</p>
                  <p className="mt-1 font-mono text-lg font-bold text-white">{formatPercent(backtestResult.winRate)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Profit Factor</p>
                  <p className="mt-1 font-mono text-lg font-bold text-white">
                    {backtestResult.profitFactor === null ? '-' : backtestResult.profitFactor.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Expectancy</p>
                  <p className={backtestResult.expectancy >= 0 ? 'mt-1 font-mono text-lg font-bold text-terminal-green' : 'mt-1 font-mono text-lg font-bold text-terminal-red'}>
                    ₹ {formatMoney(backtestResult.expectancy)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Max Drawdown</p>
                  <p className="mt-1 font-mono text-lg font-bold text-terminal-red">{formatPercent(backtestResult.maxDrawdownPct)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Trades</p>
                  <p className="mt-1 font-mono text-lg font-bold text-white">{backtestResult.tradeCount}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Final Capital</p>
                  <p className="mt-1 font-mono text-lg font-bold text-white">₹ {formatMoney(backtestResult.finalCapital)}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800 text-sm">
                  <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Entry</th>
                      <th className="px-3 py-2 text-right">Entry Px</th>
                      <th className="px-3 py-2 text-right">Exit Px</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">P&L</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/80">
                    {backtestResult.trades.length ? (
                      backtestResult.trades.map((trade, index) => (
                        <tr key={`${trade.entryTime}-${trade.exitTime}-${index}`}>
                          <td className="px-3 py-2 text-xs text-zinc-400">{new Date(trade.entryTime).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-200">{formatMoney(trade.entryPrice)}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-200">{formatMoney(trade.exitPrice)}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300">{trade.qty}</td>
                          <td className={trade.pnl >= 0 ? 'px-3 py-2 text-right font-mono text-terminal-green' : 'px-3 py-2 text-right font-mono text-terminal-red'}>
                            ₹ {formatMoney(trade.pnl)}
                          </td>
                          <td className="px-3 py-2 text-xs text-zinc-400">{trade.reason}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                          No closed trades generated under current rule set.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </article>

        <article className="terminal-card overflow-hidden">
          <header className="border-b border-zinc-800 p-4">
            <h2 className="text-base font-semibold text-white">Portfolio Risk Limits</h2>
            <p className="mt-1 text-xs text-zinc-500">Guardrails for sector concentration, position sizing, and stop-risk aggregation.</p>
          </header>

          {user ? (
            <div className="space-y-4 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-zinc-400">Max Sector %</label>
                  <input
                    type="number"
                    className="terminal-input font-mono"
                    value={riskLimits.maxSectorPct}
                    onChange={(event) => setRiskLimits((old) => ({ ...old, maxSectorPct: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-zinc-400">Max Single Position %</label>
                  <input
                    type="number"
                    className="terminal-input font-mono"
                    value={riskLimits.maxSinglePositionPct}
                    onChange={(event) => setRiskLimits((old) => ({ ...old, maxSinglePositionPct: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-zinc-400">Max Portfolio Stop-Risk %</label>
                  <input
                    type="number"
                    className="terminal-input font-mono"
                    value={riskLimits.maxStopRiskPct}
                    onChange={(event) => setRiskLimits((old) => ({ ...old, maxStopRiskPct: event.target.value }))}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Portfolio Stop-Risk</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">
                  {formatPercent(riskModel?.stopRiskPct ?? 0)}
                </p>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Active Warnings</p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                  {riskModel?.warnings.length ? (
                    riskModel.warnings.map((warning, index) => (
                      <li key={`warn-${index}`} className="text-terminal-amber">
                        {index + 1}. {warning}
                      </li>
                    ))
                  ) : (
                    <li className="text-terminal-green">No active risk-limit breaches detected.</li>
                  )}
                </ul>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Sector Exposure</p>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                    {riskModel?.sectors.length ? (
                      riskModel.sectors.map((sector) => (
                        <li key={sector.sector} className="flex items-center justify-between gap-2">
                          <span>{sector.sector}</span>
                          <span className="font-mono text-zinc-100">{formatPercent(sector.allocationPct)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-zinc-500">No sector data yet.</li>
                    )}
                  </ul>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Largest Positions</p>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                    {riskModel?.holdings.length ? (
                      riskModel.holdings.slice(0, 6).map((row) => (
                        <li key={row.holding.id} className="flex items-center justify-between gap-2">
                          <span className="font-mono text-zinc-100">{row.holding.symbol}</span>
                          <span className="font-mono">{formatPercent(row.allocationPct)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-zinc-500">No holdings loaded.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <p className="p-4 text-sm text-zinc-500">Login to enable portfolio-specific risk controls and warnings.</p>
          )}
        </article>
      </section>

      <p className="text-xs text-zinc-500">
        Intelligence tools are for research and risk management. They do not guarantee profits and are not financial advice.
      </p>
    </section>
  );
}
