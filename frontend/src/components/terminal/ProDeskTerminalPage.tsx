import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchEconomicNews,
  fetchIndices,
  fetchMarketStatus,
  fetchSignalNotebookToday,
  fetchWatchlist,
} from '../../lib/api';
import {
  EconomicNewsResponse,
  IndexApiRow,
  MarketStatusResponse,
  SignalNotebookResponse,
  WatchlistApiRow,
} from '../../types';

const PRO_DESK_REFRESH_MS = 60_000;

const DEFAULT_MARKET_STATUS: MarketStatusResponse = {
  isOpen: false,
  label: 'CLOSED',
  session: 'STATUS UNAVAILABLE',
  source: 'unknown',
  asOf: null,
};

type RegimeLabel = 'RISK_ON' | 'BALANCED' | 'RISK_OFF';

interface RegimeSnapshot {
  label: RegimeLabel;
  breadthRatio: number;
  gainers: number;
  losers: number;
  nepseChangePct: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatMoney(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatRelativeAge(iso: string | null): string {
  if (!iso) return 'awaiting feed timestamp';

  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 'feed timestamp unavailable';

  const diffMins = Math.floor((Date.now() - parsed) / (1000 * 60));
  if (diffMins <= 0) return 'just updated';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  return `${diffHours}h ago`;
}

function getAgeMinutes(iso: string | null): number | null {
  if (!iso) return null;

  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / (1000 * 60)));
}

function regimeTextClass(label: RegimeLabel): string {
  if (label === 'RISK_ON') return 'text-terminal-green';
  if (label === 'RISK_OFF') return 'text-terminal-red';
  return 'text-terminal-amber';
}

function regimeBadgeClass(label: RegimeLabel): string {
  if (label === 'RISK_ON') return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  if (label === 'RISK_OFF') return 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
  return 'border-terminal-amber/70 bg-terminal-amber/15 text-terminal-amber';
}

function impactClass(impact: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  if (impact === 'HIGH') return 'border-terminal-red/70 bg-terminal-red/20 text-terminal-red';
  if (impact === 'MEDIUM') return 'border-terminal-amber/70 bg-terminal-amber/20 text-terminal-amber';
  return 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200';
}

function signalClass(signal: 'BUY' | 'SELL'): string {
  return signal === 'BUY'
    ? 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green'
    : 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
}

function computeRegime(indices: IndexApiRow[], watchlist: WatchlistApiRow[]): RegimeSnapshot {
  const nepse = indices.find((row) => row.indexName.toLowerCase().includes('nepse'));
  const nepseChangePct = nepse?.change_pct ?? 0;

  const gainers = watchlist.filter((row) => (row.change_pct ?? 0) > 0).length;
  const losers = watchlist.filter((row) => (row.change_pct ?? 0) < 0).length;
  const breadthRatio = losers > 0 ? gainers / losers : gainers > 0 ? gainers : 1;

  if (nepseChangePct >= 0.8 && breadthRatio >= 1.1) {
    return { label: 'RISK_ON', breadthRatio, gainers, losers, nepseChangePct };
  }

  if (nepseChangePct <= -0.8 && breadthRatio <= 0.9) {
    return { label: 'RISK_OFF', breadthRatio, gainers, losers, nepseChangePct };
  }

  return { label: 'BALANCED', breadthRatio, gainers, losers, nepseChangePct };
}

function computeDeskScore(
  regime: RegimeSnapshot,
  notebook: SignalNotebookResponse | null,
  news: EconomicNewsResponse | null,
  marketStatus: MarketStatusResponse,
): { score: number; grade: 'A' | 'B' | 'C' | 'D'; label: string } {
  const summary = notebook?.summary;

  const notebookScore = summary
    ? summary.averageAccuracyPct * 0.58 + summary.winRatePct * 0.42
    : 58;

  const breadthScore = clamp(50 + (regime.breadthRatio - 1) * 24 + regime.nepseChangePct * 8, 18, 95);

  const highImpactCount = (news?.items ?? []).filter((item) => item.impact === 'HIGH').length;
  const macroPenalty = Math.min(18, highImpactCount * 3.5);

  const ageMinutes = getAgeMinutes(marketStatus.asOf);
  const freshnessPenalty =
    ageMinutes === null ? 8 : ageMinutes > 30 ? Math.min(16, (ageMinutes - 30) * 0.4) : 0;

  const regimeBoost = regime.label === 'RISK_ON' ? 8 : regime.label === 'BALANCED' ? 3 : -7;

  const score = clamp(
    notebookScore * 0.5 + breadthScore * 0.35 + 15 + regimeBoost - macroPenalty - freshnessPenalty,
    0,
    100,
  );

  if (score >= 82) return { score, grade: 'A', label: 'High-quality session for disciplined setups' };
  if (score >= 72) return { score, grade: 'B', label: 'Good setup quality with selective risk' };
  if (score >= 60) return { score, grade: 'C', label: 'Mixed conditions, reduce aggression' };
  return { score, grade: 'D', label: 'Defensive mode, preserve capital first' };
}

function formatAsOf(iso: string | null): string {
  if (!iso) return 'Awaiting source timestamp';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

function operatingModeClass(mode: 'ACTIVE' | 'SELECTIVE' | 'DEFENSIVE'): string {
  if (mode === 'ACTIVE') return 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green';
  if (mode === 'SELECTIVE') return 'border-terminal-amber/70 bg-terminal-amber/15 text-terminal-amber';
  return 'border-terminal-red/70 bg-terminal-red/15 text-terminal-red';
}

export function ProDeskTerminalPage() {
  const [indices, setIndices] = useState<IndexApiRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [notebook, setNotebook] = useState<SignalNotebookResponse | null>(null);
  const [news, setNews] = useState<EconomicNewsResponse | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatusResponse>(DEFAULT_MARKET_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const loadDesk = useCallback(async () => {
    setLoading(true);

    const [indicesRes, watchlistRes, notebookRes, newsRes, marketStatusRes] = await Promise.allSettled([
      fetchIndices(),
      fetchWatchlist(),
      fetchSignalNotebookToday(),
      fetchEconomicNews(20),
      fetchMarketStatus(),
    ]);

    let successfulCalls = 0;

    if (indicesRes.status === 'fulfilled') {
      setIndices(indicesRes.value);
      successfulCalls += 1;
    }

    if (watchlistRes.status === 'fulfilled') {
      setWatchlist(watchlistRes.value);
      successfulCalls += 1;
    }

    if (notebookRes.status === 'fulfilled') {
      setNotebook(notebookRes.value);
      successfulCalls += 1;
    }

    if (newsRes.status === 'fulfilled') {
      setNews(newsRes.value);
      successfulCalls += 1;
    }

    if (marketStatusRes.status === 'fulfilled') {
      setMarketStatus(marketStatusRes.value);
      successfulCalls += 1;
    }

    if (successfulCalls === 0) {
      setError('Unable to load NEPSE desk data right now. Please refresh in a moment.');
    } else {
      setError('');
      setLastLoadedAt(new Date().toISOString());
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDesk();

    const timer = setInterval(() => {
      void loadDesk();
    }, PRO_DESK_REFRESH_MS);

    return () => clearInterval(timer);
  }, [loadDesk]);

  const regime = useMemo(() => computeRegime(indices, watchlist), [indices, watchlist]);

  const deskScore = useMemo(
    () => computeDeskScore(regime, notebook, news, marketStatus),
    [marketStatus, news, notebook, regime],
  );

  const topCandidates = useMemo(() => {
    return [...(notebook?.entries ?? [])]
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 6);
  }, [notebook?.entries]);

  const topMovers = useMemo(() => {
    return [...watchlist]
      .filter((row) => row.change_pct !== null)
      .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0))
      .slice(0, 8);
  }, [watchlist]);

  const topTurnover = useMemo(() => {
    return [...watchlist]
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 6);
  }, [watchlist]);

  const topHeadlines = useMemo(() => {
    return [...(news?.items ?? [])]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 8);
  }, [news?.items]);

  const highImpactCount = useMemo(
    () => (news?.items ?? []).filter((item) => item.impact === 'HIGH').length,
    [news?.items],
  );

  const notebookSummary = notebook?.summary;

  const operatingPlan = useMemo(() => {
    if (deskScore.score >= 82 && regime.label === 'RISK_ON' && highImpactCount <= 1) {
      return {
        mode: 'ACTIVE' as const,
        riskPerTradePct: '1.3% - 1.8%',
        maxNewPositions: '2 to 3 quality setups',
        focus: 'Trend-following candidates with high notebook quality and strong turnover.',
        avoid: 'Overleveraging in symbols with weak liquidity depth.',
      };
    }

    if (deskScore.score >= 70) {
      return {
        mode: 'SELECTIVE' as const,
        riskPerTradePct: '0.9% - 1.2%',
        maxNewPositions: '1 to 2 best setups',
        focus: 'Only entries where checklist is complete and risk-reward remains above 2R.',
        avoid: 'Late entries after extended candles or impulsive averaging.',
      };
    }

    return {
      mode: 'DEFENSIVE' as const,
      riskPerTradePct: '0.4% - 0.8%',
      maxNewPositions: '0 to 1 small probe',
      focus: 'Capital protection, review journal, and preparation for cleaner sessions.',
      avoid: 'Frequent flip trades in noisy conditions and macro headline spikes.',
    };
  }, [deskScore.score, highImpactCount, regime.label]);

  const moduleLinks = [
    {
      to: '/execution',
      title: 'Execution Calculator',
      detail: 'Accurate NEPSE buy/sell cost simulation with scenario planning.',
    },
    {
      to: '/edge-suite',
      title: 'Trade + Signal Suite',
      detail: 'Daily notebook, smart alerts, and risk-first playbook workflow.',
    },
    {
      to: '/live-market',
      title: 'Live Market',
      detail: 'Real-time watchlist, turnover depth, and directional momentum scan.',
    },
    {
      to: '/market-news',
      title: 'Economy News',
      detail: 'Macro and policy headlines filtered for NEPSE trading impact.',
    },
  ];

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Institutional Workspace</p>
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">NEPSE Professional Trading Desk</h1>
        <p className="text-sm text-zinc-400">
          Built for disciplined execution: live regime, signal quality, macro risk, and ready-to-trade workflow in one screen.
        </p>
      </header>

      <section className="terminal-card overflow-hidden">
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.2),transparent_36%),radial-gradient(circle_at_90%_8%,rgba(245,158,11,0.18),transparent_34%)]" />
          <div className="relative grid gap-4 p-4 sm:p-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md border px-3 py-1 text-xs font-semibold tracking-wide ${regimeBadgeClass(regime.label)}`}>
                  {regime.label.replace('_', ' ')}
                </span>
                <span
                  className={
                    marketStatus.isOpen
                      ? 'rounded-md border border-terminal-green/70 bg-terminal-green/15 px-3 py-1 text-xs font-semibold tracking-wide text-terminal-green'
                      : 'rounded-md border border-terminal-red/70 bg-terminal-red/15 px-3 py-1 text-xs font-semibold tracking-wide text-terminal-red'
                  }
                >
                  MARKET {marketStatus.label}
                </span>
                <span className="rounded-md border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300">
                  Feed {formatRelativeAge(marketStatus.asOf)}
                </span>
              </div>

              <p className="mt-4 text-sm text-zinc-300">
                Session quality score combines notebook accuracy, market breadth, NEPSE direction, macro-risk pressure, and data freshness.
              </p>
              <p className="mt-1 text-xs text-zinc-500">Last synced: {lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : 'loading...'}</p>

              {error ? <p className="mt-3 text-sm font-medium text-terminal-red">{error}</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                <p className="text-xs uppercase tracking-wide text-cyan-200/90">Desk Score</p>
                <p className="mt-2 font-mono text-3xl font-bold text-white">{deskScore.score.toFixed(1)}</p>
                <p className="text-xs text-cyan-100/90">Grade {deskScore.grade}</p>
              </article>
              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Signal Win Rate</p>
                <p className="mt-2 font-mono text-2xl font-bold text-white">
                  {notebookSummary ? `${notebookSummary.winRatePct.toFixed(1)}%` : '-'}
                </p>
                <p className="text-xs text-zinc-500">Evaluated: {notebookSummary?.evaluatedCount ?? 0}</p>
              </article>
              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Market Breadth</p>
                <p className="mt-2 font-mono text-2xl font-bold text-white">{regime.breadthRatio.toFixed(2)}</p>
                <p className="text-xs text-zinc-500">{regime.gainers} up / {regime.losers} down</p>
              </article>
              <article className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">NEPSE Direction</p>
                <p className={`mt-2 font-mono text-2xl font-bold ${regimeTextClass(regime.label)}`}>
                  {formatSignedPercent(regime.nepseChangePct)}
                </p>
                <p className="text-xs text-zinc-500">{deskScore.label}</p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Notebook Coverage</p>
          <p className="mt-2 font-mono text-2xl text-white">{notebookSummary?.total ?? 0}</p>
          <p className="mt-1 text-xs text-zinc-500">BUY {notebookSummary?.buyCount ?? 0} | SELL {notebookSummary?.sellCount ?? 0}</p>
        </article>

        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Average Accuracy</p>
          <p className="mt-2 font-mono text-2xl text-cyan-200">
            {notebookSummary ? `${notebookSummary.averageAccuracyPct.toFixed(1)}%` : '-'}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Auto-evaluated post close</p>
        </article>

        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Macro Risk Alerts</p>
          <p className="mt-2 font-mono text-2xl text-terminal-amber">{highImpactCount}</p>
          <p className="mt-1 text-xs text-zinc-500">High-impact headlines today</p>
        </article>

        <article className="terminal-card p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Data Session</p>
          <p className="mt-2 text-sm text-zinc-200">Source: {marketStatus.source}</p>
          <p className="mt-1 text-xs text-zinc-500">{formatAsOf(marketStatus.asOf)}</p>
        </article>
      </section>

      <section className="terminal-card p-4 sm:p-5">
        <header className="flex flex-wrap items-center gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Trading Session Plan</p>
          <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold tracking-wide ${operatingModeClass(operatingPlan.mode)}`}>
            {operatingPlan.mode}
          </span>
        </header>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Risk Allocation</p>
            <p className="mt-2 text-sm text-zinc-300">Risk per trade: <span className="font-mono text-zinc-100">{operatingPlan.riskPerTradePct}</span></p>
            <p className="mt-1 text-sm text-zinc-300">New positions: <span className="font-mono text-zinc-100">{operatingPlan.maxNewPositions}</span></p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Execution Priority</p>
            <p className="mt-2 text-sm text-zinc-300">Focus: {operatingPlan.focus}</p>
            <p className="mt-1 text-sm text-zinc-500">Avoid: {operatingPlan.avoid}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card p-4 sm:p-5">
          <header className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Today Playbook</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Top Trade Candidates</h2>
            </div>
            <Link to="/edge-suite" className="terminal-btn text-xs">Open Suite</Link>
          </header>

          <div className="mt-4 space-y-2">
            {topCandidates.length ? (
              topCandidates.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm text-white">{entry.symbol}</p>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide ${signalClass(entry.signal)}`}>
                        {entry.signal}
                      </span>
                      <span className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-200">
                        Q {entry.qualityScore.toFixed(0)}
                      </span>
                    </div>
                  </div>

                  <p className="mt-2 text-[12px] text-zinc-400">
                    Entry {formatMoney(entry.entryPrice)} | SL {formatMoney(entry.stopLoss)} | TP {formatMoney(entry.targetPrice)}
                  </p>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    {entry.signal === 'BUY'
                      ? 'Build position only if checklist is fully aligned.'
                      : 'Use as exit/reduce signal for existing holdings in NEPSE cash market.'}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      to={`/execution?symbol=${encodeURIComponent(entry.symbol)}&side=${entry.signal === 'BUY' ? 'buy' : 'sell'}`}
                      className="terminal-btn text-xs"
                    >
                      Plan in Execution
                    </Link>
                    <Link to={`/chart-desk/${encodeURIComponent(entry.symbol)}`} className="terminal-btn text-xs">
                      Open Chart
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No live notebook candidates available right now.</p>
            )}
          </div>
        </article>

        <article className="terminal-card p-4 sm:p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Framework</p>
            <h2 className="mt-1 text-lg font-semibold text-white">NEPSE Professional Checklist</h2>
          </header>

          <div className="mt-4 space-y-2 text-sm">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300">
              1. Risk per position capped at 1-2% of deployable capital.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300">
              2. Prefer signals with quality score 78+ and clear invalidation.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300">
              3. SELL guidance means reduce/exit holdings, not shorting in cash market.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300">
              4. Avoid fresh entries when macro risk alerts are clustered high.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300">
              5. Journal decision and review after close to improve process accuracy.
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {moduleLinks.map((module) => (
              <Link key={module.to} to={module.to} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3 transition hover:border-cyan-400/70 hover:bg-cyan-500/10">
                <p className="text-sm font-semibold text-zinc-100">{module.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{module.detail}</p>
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="terminal-card p-4 sm:p-5">
          <header>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Market Scanner</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Top Movers and Turnover Leaders</h2>
          </header>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Momentum Movers</p>
              <div className="mt-2 space-y-2">
                {topMovers.length ? (
                  topMovers.map((row) => (
                    <div key={`mover-${row.symbol}`} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="font-mono text-sm text-zinc-100">{row.symbol}</span>
                      <span className={(row.change_pct ?? 0) >= 0 ? 'font-mono text-xs text-terminal-green' : 'font-mono text-xs text-terminal-red'}>
                        {formatSignedPercent(row.change_pct ?? 0)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500">No movers available.</p>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Turnover Leaders</p>
              <div className="mt-2 space-y-2">
                {topTurnover.length ? (
                  topTurnover.map((row) => (
                    <div key={`turnover-${row.symbol}`} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="font-mono text-sm text-zinc-100">{row.symbol}</span>
                      <span className="font-mono text-xs text-zinc-300">₹ {formatInteger(Math.round(row.turnover ?? 0))}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500">No turnover data available.</p>
                )}
              </div>
            </div>
          </div>
        </article>

        <article className="terminal-card p-4 sm:p-5">
          <header className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Macro Radar</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Market-Moving Headlines</h2>
            </div>
            <Link to="/market-news" className="terminal-btn text-xs">View All News</Link>
          </header>

          <div className="mt-4 space-y-2">
            {topHeadlines.length ? (
              topHeadlines.map((item, index) => (
                <a
                  key={`${item.source}-${index}-${item.url}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 transition hover:border-cyan-400/70"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide ${impactClass(item.impact)}`}>
                      {item.impact}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-zinc-500">{item.source}</span>
                    <span className="text-[11px] text-zinc-600">{formatRelativeAge(item.publishedDate)}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-200">{item.headline}</p>
                </a>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No recent macro headlines available.</p>
            )}
          </div>
        </article>
      </section>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-500">
        Accuracy note: desk metrics are generated from live market feed, signal notebook auto-evaluation, and curated economy-market headlines.
        Use this as a decision support layer, then validate with your own trade plan and risk limits.
      </div>

      <div className="flex items-center justify-end">
        <button type="button" onClick={() => void loadDesk()} className="terminal-btn">
          {loading ? 'Refreshing Desk...' : 'Refresh Desk Data'}
        </button>
      </div>
    </section>
  );
}
