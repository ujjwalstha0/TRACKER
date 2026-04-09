import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { AuthTerminalPage } from './components/terminal/AuthTerminalPage';
import { CalculatorTerminalPage } from './components/terminal/CalculatorTerminalPage';
import { ChartDeskTerminalPage } from './components/terminal/ChartDeskTerminalPage';
import { EdgeSuiteTerminalPage } from './components/terminal/EdgeSuiteTerminalPage';
import { LiveMarketTerminalPage } from './components/terminal/LiveMarketTerminalPage';
import { PortfolioTerminalPage } from './components/terminal/PortfolioTerminalPage';
import { SignalDashboardTerminalPage } from './components/terminal/SignalDashboardTerminalPage';
import { TradeJournalTerminalPage } from './components/terminal/TradeJournalTerminalPage';
import { fetchMe } from './lib/api';
import { clearAuthSession, getAuthToken, getStoredUser, setAuthSession } from './lib/auth';
import { AuthUser } from './types';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PUBLIC_NAV = [
  { to: '/', label: 'Execution', end: true },
  { to: '/live-market', label: 'Market' },
  { to: '/signal-dashboard', label: 'Signals' },
  { to: '/edge-suite', label: 'Trader Suite' },
] as NavItem[];

const PRIVATE_NAV = [
  { to: '/chart-desk', label: 'Chart Lab' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/trade-journal', label: 'Journal' },
] as NavItem[];

function ProtectedPage({ user, children }: { user: AuthUser | null; children: JSX.Element }) {
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}

export default function App() {
  const [usePureBlack, setUsePureBlack] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthChecking(false);
      setUser(null);
      return;
    }

    fetchMe()
      .then((me) => {
        setUser(me);
      })
      .catch(() => {
        clearAuthSession();
        setUser(null);
      })
      .finally(() => setAuthChecking(false));
  }, []);

  const shellClassName = useMemo(() => {
    return usePureBlack
      ? 'min-h-screen bg-[#060b10] text-white'
      : 'min-h-screen bg-[#0a1621] text-white';
  }, [usePureBlack]);

  const allNav = user ? [...PUBLIC_NAV, ...PRIVATE_NAV] : PUBLIC_NAV;

  return (
    <div className={`${shellClassName} relative overflow-x-hidden`}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.12),transparent_32%),radial-gradient(circle_at_85%_12%,rgba(245,158,11,0.11),transparent_30%),linear-gradient(145deg,#060b10_0%,#0b1623_45%,#060b10_100%)]" />
      <div className="pointer-events-none fixed -left-24 top-48 -z-10 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none fixed -right-20 bottom-24 -z-10 h-72 w-72 rounded-full bg-orange-400/10 blur-3xl" />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-cyan-900/35 bg-[linear-gradient(90deg,rgba(4,10,14,0.96),rgba(8,20,30,0.92),rgba(8,13,20,0.96))] px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] items-center gap-4">
          <div className="min-w-[160px] sm:min-w-[220px] lg:w-[20%] lg:min-w-[220px]">
            <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-200/75">NEPSE EXECUTION DESK</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">Institutional Trader Workspace</p>
          </div>

          <nav className="flex flex-1 items-center gap-2 overflow-x-auto lg:hidden">
            {allNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive
                    ? 'rounded-lg border border-cyan-300/70 bg-cyan-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-lg border border-zinc-700/80 bg-zinc-900/75 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-300 hover:border-cyan-500/60'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-md border border-zinc-700/90 bg-zinc-950/80 px-3 py-1.5 font-mono text-xs text-zinc-300 lg:inline-flex">
              {now.toLocaleString()}
            </span>

            {user ? (
              <>
                <span className="hidden rounded-md border border-zinc-700/90 bg-zinc-950/80 px-3 py-1.5 text-xs font-medium text-zinc-300 lg:inline-flex">
                  {user.displayName || user.email}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthSession();
                    setUser(null);
                  }}
                  className="rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-cyan-500/60"
                >
                  Logout
                </button>
              </>
            ) : (
              <NavLink
                to="/auth"
                className="rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 hover:bg-cyan-500/20"
              >
                Login
              </NavLink>
            )}

            <button
              type="button"
              onClick={() => setUsePureBlack((value) => !value)}
              className="rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-cyan-500/60"
            >
              {usePureBlack ? 'Ocean Tone' : 'Pure Contrast'}
            </button>
          </div>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-[73px] hidden w-[20%] min-w-[230px] border-r border-cyan-900/25 bg-[linear-gradient(180deg,rgba(6,13,19,0.95),rgba(7,16,24,0.95),rgba(5,10,15,0.95))] p-4 lg:block">
        <div className="space-y-2">
          {PUBLIC_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive
                  ? 'block rounded-lg border border-cyan-300/70 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100'
                  : 'block rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm font-medium text-zinc-300 hover:border-cyan-500/60'
              }
            >
              {item.label}
            </NavLink>
          ))}

          {PRIVATE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={user ? item.to : '/auth'}
              end={item.end}
              className={({ isActive }) =>
                isActive && user
                  ? 'block rounded-lg border border-cyan-300/70 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100'
                  : 'block rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm font-medium text-zinc-500 hover:border-cyan-500/60'
              }
            >
              {item.label} {user ? '' : '• login'}
            </NavLink>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-cyan-900/35 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Desk Status</p>
          <p className="mt-3 text-sm text-zinc-300 leading-relaxed">
            {user
              ? 'Authenticated mode: portfolio risk controls, chart lab, journal analytics, and trader suite are unlocked.'
              : 'Guest mode: execution tools, live market, signal dashboard, and trader suite are available.'}
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Rule</p>
          <p className="mt-2 text-sm text-zinc-300">Risk 1-2% per trade, respect stops, scale with proven edge.</p>
        </div>
      </aside>

      <main className="px-4 pb-8 pt-24 lg:ml-[20%] lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          {authChecking ? (
            <div className="terminal-card p-6 text-center text-zinc-400">Loading your workspace...</div>
          ) : (
            <Routes>
              <Route path="/" element={<CalculatorTerminalPage />} />
              <Route path="/live-market" element={<LiveMarketTerminalPage />} />
              <Route path="/signal-dashboard" element={<SignalDashboardTerminalPage />} />
              <Route path="/edge-suite" element={<EdgeSuiteTerminalPage user={user} />} />
              <Route
                path="/chart-desk"
                element={
                  <ProtectedPage user={user}>
                    <ChartDeskTerminalPage />
                  </ProtectedPage>
                }
              />
              <Route
                path="/chart-desk/:symbol"
                element={
                  <ProtectedPage user={user}>
                    <ChartDeskTerminalPage />
                  </ProtectedPage>
                }
              />
              <Route
                path="/chart"
                element={
                  user ? <Navigate to="/chart-desk" replace /> : <Navigate to="/auth" replace />
                }
              />
              <Route
                path="/chart/:symbol"
                element={
                  user ? <Navigate to="/chart-desk" replace /> : <Navigate to="/auth" replace />
                }
              />
              <Route
                path="/portfolio"
                element={
                  <ProtectedPage user={user}>
                    <PortfolioTerminalPage />
                  </ProtectedPage>
                }
              />
              <Route
                path="/trade-journal"
                element={
                  <ProtectedPage user={user}>
                    <TradeJournalTerminalPage />
                  </ProtectedPage>
                }
              />
              <Route
                path="/pl-simulator"
                element={
                  user ? <Navigate to="/trade-journal" replace /> : <Navigate to="/auth" replace />
                }
              />
              <Route
                path="/auth"
                element={
                  user ? (
                    <Navigate to="/portfolio" replace />
                  ) : (
                    <AuthTerminalPage
                      onAuthenticated={(token, authUser) => {
                        setAuthSession(token, authUser);
                        setUser(authUser);
                      }}
                    />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}

          <footer className="mt-8 border-t border-cyan-900/30 pt-4 text-center text-xs uppercase tracking-[0.2em] text-zinc-500">
            Developed by InfoShare Company | Built for disciplined traders
          </footer>
        </div>
      </main>
    </div>
  );
}
