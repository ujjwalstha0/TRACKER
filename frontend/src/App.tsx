import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { CalculatorTerminalPage } from './components/terminal/CalculatorTerminalPage';
import { ChartDeskTerminalPage } from './components/terminal/ChartDeskTerminalPage';
import { LiveMarketTerminalPage } from './components/terminal/LiveMarketTerminalPage';
import { TradeJournalTerminalPage } from './components/terminal/TradeJournalTerminalPage';

const NAV_ITEMS = [
  { to: '/', label: 'Buy/Sell Calc', end: true },
  { to: '/live-market', label: 'Live Market' },
  { to: '/chart-desk', label: 'Chart Desk' },
  { to: '/trade-journal', label: 'P&L Sim' },
] satisfies ReadonlyArray<{ to: string; label: string; end?: boolean }>;

export default function App() {
  const [usePureBlack, setUsePureBlack] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => clearInterval(timer);
  }, []);

  const shellClassName = useMemo(() => {
    return usePureBlack ? 'min-h-screen bg-black text-white dark:bg-black' : 'min-h-screen bg-zinc-900 text-white dark:bg-zinc-900';
  }, [usePureBlack]);

  return (
    <div className={shellClassName}>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-700/70 bg-black/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-4">
          <div className="w-[20%] min-w-[220px]">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">NEPSE EXECUTION DESK</p>
            <p className="mt-1 text-sm font-semibold text-white">Institutional Personal Terminal</p>
          </div>

          <nav className="hidden flex-1 items-center justify-center gap-2 xl:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive
                    ? 'rounded-lg border border-amber-400/70 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-300'
                    : 'rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-300 hover:border-zinc-500'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-300 lg:inline-flex">
              {now.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => setUsePureBlack((value) => !value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-zinc-500"
            >
              {usePureBlack ? 'Slate Tone' : 'Pure Black'}
            </button>
          </div>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-[73px] hidden w-[20%] min-w-[220px] border-r border-zinc-800 bg-zinc-950/95 p-4 lg:block">
        <div className="space-y-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive
                  ? 'block rounded-lg border border-amber-400/70 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300'
                  : 'block rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-600'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-zinc-800 bg-black/50 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Desk Status</p>
          <p className="mt-3 text-sm text-zinc-300">Live APIs active, calculations broker-accurate, indicators running from private VPS feed.</p>
        </div>
      </aside>

      <main className="px-4 pb-8 pt-24 lg:ml-[20%] lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          <Routes>
            <Route path="/" element={<CalculatorTerminalPage />} />
            <Route path="/live-market" element={<LiveMarketTerminalPage />} />
            <Route path="/chart-desk" element={<ChartDeskTerminalPage />} />
            <Route path="/chart-desk/:symbol" element={<ChartDeskTerminalPage />} />
            <Route path="/chart" element={<Navigate to="/chart-desk" replace />} />
            <Route path="/chart/:symbol" element={<ChartDeskTerminalPage />} />
            <Route path="/trade-journal" element={<TradeJournalTerminalPage />} />
            <Route path="/pl-simulator" element={<TradeJournalTerminalPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
