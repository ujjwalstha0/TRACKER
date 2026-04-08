import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIndices, fetchWatchlist } from '../lib/api';
import { IndexApiRow, WatchlistApiRow } from '../types';

const POLL_INTERVAL_MS = 30_000;

type SortKey = 'symbol' | 'change_pct' | 'turnover' | 'volume' | 'ltp';
type SortDirection = 'asc' | 'desc';
type TrendFilter = 'all' | 'gainers' | 'losers';

function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatInteger(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

function formatTimestamp(value: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
}

function compareValues(a: number | string, b: number | string, direction: SortDirection): number {
  const sortMultiplier = direction === 'asc' ? 1 : -1;

  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b) * sortMultiplier;
  }

  return ((a as number) - (b as number)) * sortMultiplier;
}

export function LiveMarketBoard() {
  const navigate = useNavigate();

  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [indices, setIndices] = useState<IndexApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('turnover');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all');
  const [showDetails, setShowDetails] = useState(false);

  const loadMarketData = useCallback(async () => {
    setLoading(true);
    try {
      const [watchlistRows, indexRows] = await Promise.all([fetchWatchlist(), fetchIndices()]);
      setWatchlist(watchlistRows);
      setIndices(indexRows);
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load live market data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketData();
    const timer = setInterval(() => {
      void loadMarketData();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [loadMarketData]);

  const latestIndexTime = useMemo(() => {
    if (!indices.length) return null;
    return indices
      .map((row) => row.savedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  }, [indices]);

  const marketBreadth = useMemo(() => {
    let gainers = 0;
    let losers = 0;

    for (const row of watchlist) {
      const change = row.change_pct ?? 0;
      if (change > 0) {
        gainers += 1;
      } else if (change < 0) {
        losers += 1;
      }
    }

    return {
      gainers,
      losers,
      unchanged: Math.max(0, watchlist.length - gainers - losers),
    };
  }, [watchlist]);

  const rankedRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = watchlist.filter((row) => {
      if (trendFilter === 'gainers' && (row.change_pct ?? 0) <= 0) return false;
      if (trendFilter === 'losers' && (row.change_pct ?? 0) >= 0) return false;

      if (!normalizedSearch) return true;

      return (
        row.symbol.toLowerCase().includes(normalizedSearch) ||
        (row.company ?? '').toLowerCase().includes(normalizedSearch) ||
        (row.sector ?? '').toLowerCase().includes(normalizedSearch)
      );
    });

    return filtered.sort((a, b) => {
      if (sortKey === 'symbol') {
        return compareValues(a.symbol, b.symbol, sortDirection);
      }

      const aValue = a[sortKey] ?? 0;
      const bValue = b[sortKey] ?? 0;
      return compareValues(aValue, bValue, sortDirection);
    });
  }, [search, sortDirection, sortKey, trendFilter, watchlist]);

  const topTurnoverRows = useMemo(() => {
    return [...watchlist]
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 8);
  }, [watchlist]);

  const topMovers = useMemo(() => {
    return [...watchlist]
      .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0))
      .slice(0, 8);
  }, [watchlist]);

  const leadTurnover = topTurnoverRows[0] ?? null;
  const visibleRows = showDetails ? rankedRows : rankedRows.slice(0, 12);

  return (
    <section className="card live-board">
      <div className="live-header">
        <div>
          <h2>Live Market Feed</h2>
          <p className="subtle">Start with top signals, then expand detail only when you need it.</p>
        </div>
        <button className="theme-btn" type="button" onClick={() => void loadMarketData()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Now'}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="summary-grid live-kpi-grid">
        <article className="summary-card">
          <p>Total Symbols</p>
          <h3>{formatInteger(watchlist.length)}</h3>
          <small>Gainers: {marketBreadth.gainers} | Losers: {marketBreadth.losers}</small>
        </article>
        <article className="summary-card">
          <p>Indices Rows</p>
          <h3>{formatInteger(indices.length)}</h3>
          <small>Index snapshot: {formatTimestamp(latestIndexTime)}</small>
        </article>
        <article className="summary-card">
          <p>Leader by Turnover</p>
          <h3>{leadTurnover ? leadTurnover.symbol : '-'}</h3>
          <small>{leadTurnover ? `Rs. ${formatNumber(leadTurnover.turnover)}` : 'No turnover yet'}</small>
        </article>
        <article className="summary-card">
          <p>Last Refreshed</p>
          <h3>{lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}</h3>
          <small>Polling every 30 seconds</small>
        </article>
      </div>

      <div className="mini-live-ticker chart-quick-picks">
        {topMovers.length ? (
          topMovers.map((row) => (
            <button key={row.symbol} type="button" className="mini-live-symbol" onClick={() => navigate(`/chart/${row.symbol}`)}>
              <strong>{row.symbol}</strong> {formatNumber(row.change_pct)}%
            </button>
          ))
        ) : (
          <span>Top movers will appear after data arrives.</span>
        )}
      </div>

      <div className="live-grid">
        <article className="scenario-card">
          <h3>Indices Snapshot</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Value</th>
                  <th>Change</th>
                  <th>Change %</th>
                </tr>
              </thead>
              <tbody>
                {indices.length ? (
                  indices.map((row) => (
                    <tr key={row.indexName}>
                      <td>{row.indexName}</td>
                      <td>{formatNumber(row.value)}</td>
                      <td className={row.change >= 0 ? 'profit' : 'loss'}>{formatNumber(row.change)}</td>
                      <td className={row.change_pct >= 0 ? 'profit' : 'loss'}>{formatNumber(row.change_pct)}%</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>No index rows available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="scenario-card">
          <h3>Most Active by Turnover</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>LTP</th>
                  <th>Turnover</th>
                </tr>
              </thead>
              <tbody>
                {topTurnoverRows.length ? (
                  topTurnoverRows.map((row) => (
                    <tr key={row.symbol}>
                      <td>
                        <button type="button" className="table-link-btn" onClick={() => navigate(`/chart/${row.symbol}`)}>
                          {row.symbol}
                        </button>
                      </td>
                      <td>{formatNumber(row.ltp)}</td>
                      <td>{formatNumber(row.turnover)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>No watchlist rows available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <section className="live-controls card-lite">
        <div className="field-group">
          <label className="label" htmlFor="marketSearch">
            Search Symbol/Company
          </label>
          <input
            id="marketSearch"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="NABIL, NICA, hydropower..."
          />
        </div>

        <div className="field-group">
          <label className="label" htmlFor="marketSortKey">
            Sort by
          </label>
          <select id="marketSortKey" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="turnover">Turnover</option>
            <option value="change_pct">Change %</option>
            <option value="volume">Volume</option>
            <option value="ltp">LTP</option>
            <option value="symbol">Symbol</option>
          </select>
        </div>

        <div className="field-group">
          <label className="label" htmlFor="trendFilter">
            Filter
          </label>
          <select id="trendFilter" value={trendFilter} onChange={(e) => setTrendFilter(e.target.value as TrendFilter)}>
            <option value="all">All</option>
            <option value="gainers">Gainers only</option>
            <option value="losers">Losers only</option>
          </select>
        </div>

        <div className="live-control-buttons">
          <button
            className="theme-btn"
            type="button"
            onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          >
            {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          </button>
          <button className="theme-btn" type="button" onClick={() => setShowDetails((prev) => !prev)}>
            {showDetails ? 'Show Focus Mode' : 'Show Full Detail'}
          </button>
        </div>
      </section>

      <div className="table-wrap live-full-table">
        <h3>{showDetails ? 'Full Watchlist Detail' : 'Focused Watchlist Snapshot (Top 12)'}</h3>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>LTP</th>
              <th>Change %</th>
              <th>Turnover</th>
              {showDetails ? <th>Open</th> : null}
              {showDetails ? <th>High</th> : null}
              {showDetails ? <th>Low</th> : null}
              {showDetails ? <th>Volume</th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <tr key={row.symbol}>
                  <td>
                    <button type="button" className="table-link-btn" onClick={() => navigate(`/chart/${row.symbol}`)}>
                      {row.symbol}
                    </button>
                  </td>
                  <td>{formatNumber(row.ltp)}</td>
                  <td className={row.change_pct !== null && row.change_pct >= 0 ? 'profit' : row.change_pct !== null ? 'loss' : ''}>
                    {formatNumber(row.change_pct)}
                    {row.change_pct === null ? '' : '%'}
                  </td>
                  <td>{formatNumber(row.turnover)}</td>
                  {showDetails ? <td>{formatNumber(row.open)}</td> : null}
                  {showDetails ? <td>{formatNumber(row.high)}</td> : null}
                  {showDetails ? <td>{formatNumber(row.low)}</td> : null}
                  {showDetails ? <td>{formatInteger(row.volume)}</td> : null}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={showDetails ? 8 : 4}>No rows match the current filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
