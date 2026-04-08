import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { AuthTerminalPage } from './components/terminal/AuthTerminalPage';
import { CalculatorTerminalPage } from './components/terminal/CalculatorTerminalPage';
import { ChartDeskTerminalPage } from './components/terminal/ChartDeskTerminalPage';
import { LiveMarketTerminalPage } from './components/terminal/LiveMarketTerminalPage';
import { PortfolioTerminalPage } from './components/terminal/PortfolioTerminalPage';
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
  { to: '/', label: 'Buy/Sell Calc', end: true },
  { to: '/live-market', label: 'Live Market' },
] as NavItem[];

const PRIVATE_NAV = [
  { to: '/chart-desk', label: 'Chart Desk' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/trade-journal', label: 'Trade Journal' },
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
    return usePureBlack ? 'min-h-screen bg-black text-white dark:bg-black' : 'min-h-screen bg-zinc-900 text-white dark:bg-zinc-900';
  }, [usePureBlack]);

  const allNav = user ? [...PUBLIC_NAV, ...PRIVATE_NAV] : PUBLIC_NAV;

  return (
    <div className={shellClassName}>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-700/70 bg-black/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-4">
          <div className="min-w-[160px] sm:min-w-[220px] lg:w-[20%] lg:min-w-[220px]">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">NEPSE EXECUTION DESK</p>
            <p className="mt-1 text-sm font-semibold text-white">Institutional Personal Terminal</p>
          </div>

          <nav className="flex flex-1 items-center gap-2 overflow-x-auto lg:hidden">
            {allNav.map((item) => (
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

            {user ? (
              <>
                <span className="hidden rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 lg:inline-flex">
                  {user.displayName || user.email}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthSession();
                    setUser(null);
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-zinc-500"
                >
                  Logout
                </button>
              </>
            ) : (
              <NavLink
                to="/auth"
                className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-500/20"
              >
                Login
              </NavLink>
            )}

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
          {PUBLIC_NAV.map((item) => (
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

          {PRIVATE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={user ? item.to : '/auth'}
              end={item.end}
              className={({ isActive }) =>
                isActive && user
                  ? 'block rounded-lg border border-amber-400/70 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300'
                  : 'block rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-500 hover:border-zinc-600'
              }
            >
              {item.label} {user ? '' : '• login'}
            </NavLink>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-zinc-800 bg-black/50 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Desk Status</p>
          <p className="mt-3 text-sm text-zinc-300">
            {user
              ? 'Authenticated: Portfolio tracking, chart desk, and journal unlocked.'
              : 'Guest mode: Buy/Sell Calculator and Live Market are available.'}
          </p>
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
        </div>
      </main>
    </div>
  );
}
