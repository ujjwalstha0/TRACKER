import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchIndices, fetchWatchlist } from '../lib/api';
import { IndexApiRow, WatchlistApiRow } from '../types';

const POLL_INTERVAL_MS = 30_000;

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

export function LiveMarketBoard() {
  const [watchlist, setWatchlist] = useState<WatchlistApiRow[]>([]);
  const [indices, setIndices] = useState<IndexApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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

  const topTurnoverRows = useMemo(() => {
    return [...watchlist]
      .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 16);
  }, [watchlist]);

  const latestIndexTime = useMemo(() => {
    if (!indices.length) return null;
    return indices
      .map((row) => row.savedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  }, [indices]);

  return (
    <section className="card live-board">
      <div className="live-header">
        <div>
          <h2>Live Market Feed</h2>
          <p className="subtle">Watchlist and indices refresh every 30 seconds from your private backend API.</p>
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
          <small>From /api/watchlist</small>
        </article>
        <article className="summary-card">
          <p>Indices Rows</p>
          <h3>{formatInteger(indices.length)}</h3>
          <small>From /api/indices</small>
        </article>
        <article className="summary-card">
          <p>Last Refreshed</p>
          <h3>{lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}</h3>
          <small>Index snapshot: {formatTimestamp(latestIndexTime)}</small>
        </article>
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
                      <td>{row.symbol}</td>
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

      <div className="table-wrap live-full-table">
        <h3>Watchlist Snapshot</h3>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>LTP</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Change %</th>
              <th>Turnover</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.length ? (
              watchlist.map((row) => (
                <tr key={row.symbol}>
                  <td>{row.symbol}</td>
                  <td>{formatNumber(row.ltp)}</td>
                  <td>{formatNumber(row.open)}</td>
                  <td>{formatNumber(row.high)}</td>
                  <td>{formatNumber(row.low)}</td>
                  <td className={row.change_pct !== null && row.change_pct >= 0 ? 'profit' : row.change_pct !== null ? 'loss' : ''}>
                    {formatNumber(row.change_pct)}
                    {row.change_pct === null ? '' : '%'}
                  </td>
                  <td>{formatNumber(row.turnover)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No watchlist rows available yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}