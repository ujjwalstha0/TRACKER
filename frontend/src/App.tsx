import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AuthTerminalPage } from './components/terminal/AuthTerminalPage';
import { CalculatorTerminalPage } from './components/terminal/CalculatorTerminalPage';
import { ChartDeskTerminalPage } from './components/terminal/ChartDeskTerminalPage';
import { EdgeSuiteTerminalPage } from './components/terminal/EdgeSuiteTerminalPage';
import { LiveMarketTerminalPage } from './components/terminal/LiveMarketTerminalPage';
import { MarketNewsTerminalPage } from './components/terminal/MarketNewsTerminalPage';
import { PortfolioTerminalPage } from './components/terminal/PortfolioTerminalPage';
import { ProDeskTerminalPage } from './components/terminal/ProDeskTerminalPage';
import { TradeJournalTerminalPage } from './components/terminal/TradeJournalTerminalPage';
import { fetchMarketStatus, fetchMe } from './lib/api';
import { clearAuthSession, getAuthToken, getStoredUser, setAuthSession } from './lib/auth';
import { AuthUser, MarketStatusResponse } from './types';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PUBLIC_NAV = [
  { to: '/', label: 'Pro Desk', end: true },
  { to: '/execution', label: 'Execution' },
  { to: '/live-market', label: 'Market' },
  { to: '/market-news', label: 'Economy News' },
  { to: '/edge-suite', label: 'Trade + Signal Suite' },
] as NavItem[];

const PRIVATE_NAV = [
  { to: '/chart-desk', label: 'Chart Lab' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/trade-journal', label: 'Journal' },
] as NavItem[];

const MARKET_STATUS_POLL_INTERVAL_MS = 60_000;

const DEFAULT_MARKET_STATUS: MarketStatusResponse = {
  isOpen: false,
  label: 'CLOSED',
  session: 'STATUS UNAVAILABLE',
  source: 'unknown',
  asOf: null,
};

function ProtectedPage({ user, children }: { user: AuthUser | null; children: JSX.Element }) {
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}

function getUserInitial(user: AuthUser): string {
  const source = user.displayName?.trim() || user.email.trim();
  return source.charAt(0).toUpperCase() || 'U';
}

export default function App() {
  const location = useLocation();
  const [usePureBlack, setUsePureBlack] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [marketStatus, setMarketStatus] = useState<MarketStatusResponse>(DEFAULT_MARKET_STATUS);
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [authChecking, setAuthChecking] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      document.body.style.overflow = '';
      return;
    }

    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

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

  useEffect(() => {
    let isMounted = true;

    const loadMarketStatus = async () => {
      try {
        const nextStatus = await fetchMarketStatus();
        if (!isMounted) {
          return;
        }

        setMarketStatus(nextStatus);
      } catch {
        // Keep the last known status if upstream sources are briefly unavailable.
      }
    };

    void loadMarketStatus();

    const timer = setInterval(() => {
      void loadMarketStatus();
    }, MARKET_STATUS_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      if (!userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
        setMobileNavOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
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

      <header className="fixed inset-x-0 top-0 z-50 border-b border-cyan-900/35 bg-[linear-gradient(90deg,rgba(4,10,14,0.97),rgba(8,20,30,0.95),rgba(8,13,20,0.97))] px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] items-center gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:min-w-[250px] lg:w-[20%] lg:min-w-[250px]">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-500/15 font-mono text-sm font-bold text-cyan-100">
              NX
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-200/75">NEPSE EXECUTION DESK</p>
              <p className="mt-1 hidden truncate text-sm font-semibold text-zinc-100 sm:block">Professional Trading Terminal</p>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-end lg:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen((old) => !old)}
              className="rounded-lg border border-zinc-700/80 bg-zinc-900/75 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200"
              aria-expanded={mobileNavOpen}
              aria-label="Toggle navigation menu"
            >
              {mobileNavOpen ? 'Close Menu' : 'Menu'}
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span
              title={`Session: ${marketStatus.session}${marketStatus.asOf ? ` | As of ${marketStatus.asOf}` : ''} | Source: ${marketStatus.source}`}
              className={
                marketStatus.isOpen
                  ? 'rounded-md border border-terminal-green/60 bg-terminal-green/15 px-3 py-1.5 font-mono text-xs font-semibold tracking-wide text-terminal-green'
                  : 'rounded-md border border-terminal-red/60 bg-terminal-red/15 px-3 py-1.5 font-mono text-xs font-semibold tracking-wide text-terminal-red'
              }
            >
              ● MARKET {marketStatus.label}
            </span>

            <span className="hidden rounded-md border border-zinc-700/90 bg-zinc-950/80 px-3 py-1.5 font-mono text-xs text-zinc-300 lg:inline-flex">
              {now.toLocaleString()}
            </span>

            {user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((old) => !old)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-500/60 bg-cyan-500/20 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300"
                  aria-label="User menu"
                >
                  {getUserInitial(user)}
                </button>

                {userMenuOpen ? (
                  <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-zinc-700/90 bg-zinc-950/95 p-3 shadow-terminal backdrop-blur">
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Signed In</p>
                    <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{user.displayName || user.email}</p>
                    <p className="truncate text-xs text-zinc-400">{user.email}</p>

                    <button
                      type="button"
                      onClick={() => {
                        clearAuthSession();
                        setUser(null);
                        setUserMenuOpen(false);
                      }}
                      className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-cyan-500/60"
                    >
                      Logout
                    </button>
                  </div>
                ) : null}
              </div>
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
              className="hidden rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-cyan-500/60 sm:inline-flex"
            >
              {usePureBlack ? 'Ocean Tone' : 'Pure Contrast'}
            </button>
          </div>
        </div>
      </header>

      {mobileNavOpen ? (
        <div
          className="fixed inset-0 top-[73px] z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="mx-3 mt-3 max-h-[calc(100dvh-92px)] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-terminal"
            onClick={(event) => event.stopPropagation()}
          >
            <nav className="grid gap-2">
              {allNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive
                      ? 'rounded-lg border border-cyan-300/70 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100'
                      : 'rounded-lg border border-zinc-700/80 bg-zinc-900/75 px-3 py-2 text-sm font-semibold text-zinc-300'
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <button
              type="button"
              onClick={() => setUsePureBlack((value) => !value)}
              className="mt-3 w-full rounded-lg border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200"
            >
              {usePureBlack ? 'Switch To Ocean Tone' : 'Switch To Pure Contrast'}
            </button>
          </div>
        </div>
      ) : null}

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
              ? 'Authenticated mode: Pro Desk, portfolio risk controls, chart lab, journal analytics, and suite tools are unlocked.'
              : 'Guest mode: Pro Desk, execution tools, live market, and the Trade + Signal Suite are available.'}
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Rule</p>
          <p className="mt-2 text-sm text-zinc-300">Risk 1-2% per trade, respect stops, scale with proven edge.</p>
        </div>
      </aside>

      <main className="px-3 pb-8 pt-24 sm:px-4 lg:ml-[20%] lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          {authChecking ? (
            <div className="terminal-card p-6 text-center text-zinc-400">Loading your workspace...</div>
          ) : (
            <Routes>
              <Route path="/" element={<ProDeskTerminalPage />} />
              <Route path="/execution" element={<CalculatorTerminalPage />} />
              <Route path="/live-market" element={<LiveMarketTerminalPage />} />
              <Route path="/market-news" element={<MarketNewsTerminalPage />} />
              <Route path="/edge-suite" element={<EdgeSuiteTerminalPage user={user} />} />
              <Route path="/signal-dashboard" element={<Navigate to="/edge-suite" replace />} />
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

          <footer className="mt-10 border-t border-cyan-900/35 pt-5">
            <div className="grid gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 md:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">InfoShare Terminal</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Institutional-grade execution workspace for live market monitoring, signal analysis, and risk-managed planning.
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Platform Modules</p>
                <p className="mt-2 text-sm text-zinc-300">Pro Desk, Execution, Market, Economy News, Trade + Signal Suite, Chart Lab, Portfolio, Journal</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Data Session</p>
                <p className="mt-2 text-sm text-zinc-300">Market: {marketStatus.label} • Source: {marketStatus.source}</p>
                <p className="text-xs text-zinc-500">{marketStatus.asOf ? `As of ${marketStatus.asOf}` : 'Awaiting source timestamp'}</p>
              </div>
            </div>
            <p className="mt-4 text-center text-xs uppercase tracking-[0.2em] text-zinc-500">
              Developed by InfoShare Company • Built for disciplined traders
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
