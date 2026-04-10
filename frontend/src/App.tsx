import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthTerminalPage } from './components/terminal/AuthTerminalPage';
import { CalculatorTerminalPage } from './components/terminal/CalculatorTerminalPage';
import { EdgeSuiteTerminalPage } from './components/terminal/EdgeSuiteTerminalPage';
import { FloorsheetTerminalPage } from './components/terminal/FloorsheetTerminalPage';
import { LiveMarketTerminalPage } from './components/terminal/LiveMarketTerminalPage';
import { MarketNewsTerminalPage } from './components/terminal';
import { PortfolioTerminalPage } from './components/terminal/PortfolioTerminalPage';
import { ProDeskTerminalPage } from './components/terminal/ProDeskTerminalPage';
import { TradeJournalTerminalPage } from './components/terminal/TradeJournalTerminalPage';
import { fetchMarketStatus, fetchMe } from './lib/api';
import { clearAuthSession, getAuthToken, getStoredUser, setAuthSession } from './lib/auth';
import { AuthUser, MarketStatusResponse } from './types';

const ChartDeskTerminalPage = lazy(() =>
  import('./components/terminal/ChartDeskTerminalPage').then((module) => ({
    default: module.ChartDeskTerminalPage,
  })),
);

interface NavItem {
  to: string;
  label: string;
  short: string;
  description: string;
  shortcutKey: string;
  requiresAuth?: boolean;
  end?: boolean;
}

const PUBLIC_NAV = [
  { to: '/', label: 'Pro Desk', short: 'PD', description: 'Session score and operating mode', shortcutKey: 'Alt+1', end: true },
  { to: '/execution', label: 'Execution', short: 'EX', description: 'Position sizing and cost planning', shortcutKey: 'Alt+2' },
  { to: '/live-market', label: 'Market', short: 'LM', description: 'Live movers and turnover depth', shortcutKey: 'Alt+3' },
  { to: '/floorsheet-lab', label: 'Floorsheet Lab', short: 'FL', description: 'Broker flow and transfer pressure', shortcutKey: 'Alt+4' },
  { to: '/market-news', label: 'Economy News', short: 'NW', description: 'Summary-first macro impact feed', shortcutKey: 'Alt+5' },
  { to: '/edge-suite', label: 'Trade + Signal Suite', short: 'SU', description: 'Signal quality and risk workflow', shortcutKey: 'Alt+6' },
] as NavItem[];

const PRIVATE_NAV = [
  { to: '/chart-desk', label: 'Chart Lab', short: 'CH', description: 'Structure, indicators, and setup timing', shortcutKey: 'Alt+7', requiresAuth: true },
  { to: '/portfolio', label: 'Portfolio', short: 'PF', description: 'Live holdings and exposure control', shortcutKey: 'Alt+8', requiresAuth: true },
  { to: '/trade-journal', label: 'Journal', short: 'JR', description: 'Decision review and improvement loop', shortcutKey: 'Alt+9', requiresAuth: true },
] as NavItem[];

const MARKET_STATUS_POLL_INTERVAL_MS = 60_000;
const UI_DENSITY_STORAGE_KEY = 'infoshare.ui-density';
const THEME_PRESET_STORAGE_KEY = 'infoshare.theme-preset';
const DISMISSED_HINTS_STORAGE_KEY = 'infoshare.dismissed-hints.v1';

type UiDensity = 'comfortable' | 'compact';
type ThemePreset = 'institutional' | 'high-contrast' | 'compact-pro';

interface ShortcutItem {
  key: string;
  title: string;
  route: string;
  requiresAuth?: boolean;
}

interface RouteHint {
  key: string;
  title: string;
  detail: string;
  tips: string[];
}

const SHORTCUTS: ShortcutItem[] = [
  { key: 'Alt+1', title: 'Pro Desk', route: '/' },
  { key: 'Alt+2', title: 'Execution', route: '/execution' },
  { key: 'Alt+3', title: 'Live Market', route: '/live-market' },
  { key: 'Alt+4', title: 'Floorsheet Lab', route: '/floorsheet-lab' },
  { key: 'Alt+5', title: 'Economy News', route: '/market-news' },
  { key: 'Alt+6', title: 'Trade + Signal Suite', route: '/edge-suite' },
  { key: 'Alt+7', title: 'Chart Lab', route: '/chart-desk', requiresAuth: true },
  { key: 'Alt+8', title: 'Portfolio', route: '/portfolio', requiresAuth: true },
  { key: 'Alt+9', title: 'Journal', route: '/trade-journal', requiresAuth: true },
];

const DEFAULT_MARKET_STATUS: MarketStatusResponse = {
  isOpen: false,
  label: 'CLOSED',
  session: 'STATUS UNAVAILABLE',
  source: 'unknown',
  asOf: null,
};

function readStoredDensity(): UiDensity {
  try {
    const raw = localStorage.getItem(UI_DENSITY_STORAGE_KEY);
    return raw === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function readStoredThemePreset(): ThemePreset {
  try {
    const raw = localStorage.getItem(THEME_PRESET_STORAGE_KEY);
    if (raw === 'high-contrast' || raw === 'compact-pro') {
      return raw;
    }

    return 'institutional';
  } catch {
    return 'institutional';
  }
}

function readDismissedHints(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_HINTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function hintForPath(pathname: string): RouteHint | null {
  if (pathname === '/') {
    return {
      key: 'pro-desk',
      title: 'Start Every Session Here',
      detail: 'Read regime, desk score, and risk mode before placing any order.',
      tips: [
        'Use Desk Score plus regime together before increasing trade size.',
        'Check Macro Radar briefs first, then open source only if needed.',
        'Use Alt+2 for Execution and Alt+7 for Chart Lab while planning entries.',
      ],
    };
  }

  if (pathname === '/execution') {
    return {
      key: 'execution',
      title: 'Execution Flow',
      detail: 'Convert setup into exact quantity, stop, and reward-to-risk before committing.',
      tips: [
        'Set realistic stop and target first, then calculate quantity.',
        'Keep risk per trade inside your session plan from Pro Desk.',
        'Use Alt+1 to re-check conditions when market tone shifts.',
      ],
    };
  }

  if (pathname === '/live-market') {
    return {
      key: 'live-market',
      title: 'Live Market Scan',
      detail: 'Use this page to shortlist symbols with real momentum and turnover support.',
      tips: [
        'Filter by sector and change to reduce noise before chart review.',
        'Cross-check top movers with turnover to avoid weak moves.',
        'Jump to Floorsheet Lab with Alt+4 for broker-flow confirmation.',
      ],
    };
  }

  if (pathname === '/floorsheet-lab') {
    return {
      key: 'floorsheet-lab',
      title: 'Broker Flow Intelligence',
      detail: 'Validate demand or distribution using block prints and transfer pressure.',
      tips: [
        'Trust sustained net flow, not single-print spikes.',
        'Use Plan Trade only when flow aligns with technical structure.',
        'Open Chart Lab with Alt+7 for entry timing confirmation.',
      ],
    };
  }

  if (pathname === '/market-news') {
    return {
      key: 'market-news',
      title: 'Summary-First Macro Feed',
      detail: 'Understand impact from summaries first, then open source only for verification.',
      tips: [
        'Filter high-impact items when risk conditions are fragile.',
        'Use tags to connect headlines with sectors in your watchlist.',
        'Return to Pro Desk with Alt+1 after reviewing major headlines.',
      ],
    };
  }

  if (pathname === '/edge-suite') {
    return {
      key: 'edge-suite',
      title: 'Signal And Risk Workflow',
      detail: 'Run notebook, evaluate quality, and align entries with risk controls.',
      tips: [
        'Take only checklist-complete setups during selective sessions.',
        'Prefer quality and consistency over signal quantity.',
        'Use Alt+2 to finalize cost/risk before execution.',
      ],
    };
  }

  if (pathname.startsWith('/chart-desk')) {
    return {
      key: 'chart-desk',
      title: 'Chart Lab Routine',
      detail: 'Confirm structure, trend context, and invalidation before planning a trade.',
      tips: [
        'Use indicators as confirmation, not as standalone signals.',
        'Record the setup in Journal after market close for feedback.',
        'Use Alt+2 to open Execution for precise order sizing.',
      ],
    };
  }

  if (pathname === '/portfolio') {
    return {
      key: 'portfolio',
      title: 'Portfolio Control Center',
      detail: 'Track live exposure, unrealized risk, and target/stop discipline.',
      tips: [
        'Keep stop levels updated as structure changes.',
        'Avoid concentration in a single correlated sector.',
        'Review daily with Journal using Alt+9.',
      ],
    };
  }

  if (pathname === '/trade-journal') {
    return {
      key: 'trade-journal',
      title: 'Performance Feedback Loop',
      detail: 'Capture decision quality and mistakes to improve next sessions.',
      tips: [
        'Log both wins and losses with equal detail.',
        'Track recurring setup errors before increasing risk.',
        'Use insights here to tighten your Pro Desk operating plan.',
      ],
    };
  }

  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}

function routeFromShortcutKey(key: string): string | null {
  const lookup = SHORTCUTS.find((item) => item.key === `Alt+${key}`);
  return lookup?.route ?? null;
}

function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.end) {
    return pathname === item.to;
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function routeSummary(pathname: string): { title: string; detail: string } {
  if (pathname === '/') {
    return {
      title: 'Session Command Center',
      detail: 'Monitor regime, macro pressure, and setup quality before committing risk.',
    };
  }

  if (pathname === '/execution') {
    return {
      title: 'Order Planning Workspace',
      detail: 'Convert ideas into exact position size, stop risk, and realistic target profile.',
    };
  }

  if (pathname === '/live-market') {
    return {
      title: 'Live Opportunity Scanner',
      detail: 'Filter real momentum by combining change, turnover, and breadth context.',
    };
  }

  if (pathname === '/floorsheet-lab') {
    return {
      title: 'Broker Flow Intelligence Hub',
      detail: 'Validate accumulation or distribution with concentration and print quality.',
    };
  }

  if (pathname === '/market-news') {
    return {
      title: 'Macro Summary Console',
      detail: 'Read structured impact summaries first and open source only when needed.',
    };
  }

  if (pathname === '/edge-suite') {
    return {
      title: 'Signal And Risk Lab',
      detail: 'Align signal confidence, checklist quality, and risk allocation before entry.',
    };
  }

  if (pathname.startsWith('/chart-desk')) {
    return {
      title: 'Technical Validation Workspace',
      detail: 'Confirm trend, structure, and invalidation levels for disciplined execution.',
    };
  }

  if (pathname === '/portfolio') {
    return {
      title: 'Exposure Management Panel',
      detail: 'Track open-risk concentration and control downside with updated stops.',
    };
  }

  if (pathname === '/trade-journal') {
    return {
      title: 'Performance Feedback Engine',
      detail: 'Capture mistakes and repeatable wins to improve strategy quality over time.',
    };
  }

  return {
    title: 'Professional Trading Workspace',
    detail: 'Move from context to execution with risk-first discipline on every module.',
  };
}

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
  const navigate = useNavigate();
  const [usePureBlack, setUsePureBlack] = useState(true);
  const [uiDensity, setUiDensity] = useState<UiDensity>(() => readStoredDensity());
  const [themePreset, setThemePreset] = useState<ThemePreset>(() => readStoredThemePreset());
  const [now, setNow] = useState(() => new Date());
  const [marketStatus, setMarketStatus] = useState<MarketStatusResponse>(DEFAULT_MARKET_STATUS);
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [authChecking, setAuthChecking] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [dismissedHints, setDismissedHints] = useState<string[]>(() => readDismissedHints());
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(UI_DENSITY_STORAGE_KEY, uiDensity);
    } catch {
      // Ignore storage failures; density still applies for current session.
    }
  }, [uiDensity]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_PRESET_STORAGE_KEY, themePreset);
    } catch {
      // Ignore storage failures; preset still applies for current session.
    }
  }, [themePreset]);

  useEffect(() => {
    if (themePreset === 'compact-pro') {
      setUiDensity('compact');
    }
  }, [themePreset]);

  useEffect(() => {
    try {
      localStorage.setItem(DISMISSED_HINTS_STORAGE_KEY, JSON.stringify(dismissedHints));
    } catch {
      // Ignore storage failures; hints remain active in current session.
    }
  }, [dismissedHints]);

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
        setShowShortcutHelp(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (!event.altKey && event.key === '?') {
        event.preventDefault();
        setShowShortcutHelp((prev) => !prev);
        return;
      }

      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowShortcutHelp((prev) => !prev);
        return;
      }

      const route = routeFromShortcutKey(event.key);
      if (!route) {
        return;
      }

      event.preventDefault();

      const needsAuth = !!SHORTCUTS.find((item) => item.route === route)?.requiresAuth;
      if (needsAuth && !user) {
        navigate('/auth');
        return;
      }

      navigate(route);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate, user]);

  const shellClassName = useMemo(() => {
    return usePureBlack
      ? 'min-h-screen bg-[#060b10] text-white'
      : 'min-h-screen bg-[#0a1621] text-white';
  }, [usePureBlack]);

  const allNav = user ? [...PUBLIC_NAV, ...PRIVATE_NAV] : PUBLIC_NAV;
  const mobileDockNav = PUBLIC_NAV.slice(0, 5);
  const activeHint = hintForPath(location.pathname);
  const showHintCard = !!activeHint && !dismissedHints.includes(activeHint.key);
  const activeNavItem = allNav.find((item) => isNavItemActive(location.pathname, item)) ?? null;
  const currentRouteSummary = routeSummary(location.pathname);

  const applyThemePreset = (preset: ThemePreset) => {
    setThemePreset(preset);
    if (preset === 'compact-pro') {
      setUiDensity('compact');
    }
  };

  return (
    <div className={`${shellClassName} relative overflow-x-hidden ui-density-${uiDensity} theme-preset-${themePreset}`}>
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

            <button
              type="button"
              onClick={() => setUiDensity((prev) => (prev === 'comfortable' ? 'compact' : 'comfortable'))}
              className="hidden rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-cyan-500/60 sm:inline-flex"
            >
              {uiDensity === 'compact' ? 'Comfortable View' : 'Compact View'}
            </button>

            <button
              type="button"
              onClick={() => setShowShortcutHelp(true)}
              className="hidden rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200 hover:border-cyan-500/60 xl:inline-flex"
            >
              Shortcuts
            </button>

            <div className="hidden items-center gap-1 rounded-lg border border-zinc-700/90 bg-zinc-950/80 p-1 2xl:flex">
              <button
                type="button"
                onClick={() => applyThemePreset('institutional')}
                className={
                  themePreset === 'institutional'
                    ? 'rounded-md border border-cyan-400/70 bg-cyan-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300'
                }
              >
                Institutional
              </button>
              <button
                type="button"
                onClick={() => applyThemePreset('high-contrast')}
                className={
                  themePreset === 'high-contrast'
                    ? 'rounded-md border border-cyan-400/70 bg-cyan-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300'
                }
              >
                High Contrast
              </button>
              <button
                type="button"
                onClick={() => applyThemePreset('compact-pro')}
                className={
                  themePreset === 'compact-pro'
                    ? 'rounded-md border border-cyan-400/70 bg-cyan-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300'
                }
              >
                Compact Pro
              </button>
            </div>
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="nav-code-pill">{item.short}</span>
                      <span>{item.label}</span>
                    </span>
                    <span className="text-[10px] text-zinc-500">{item.shortcutKey}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-normal text-zinc-500">{item.description}</p>
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

            <button
              type="button"
              onClick={() => setUiDensity((prev) => (prev === 'comfortable' ? 'compact' : 'comfortable'))}
              className="mt-2 w-full rounded-lg border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200"
            >
              {uiDensity === 'compact' ? 'Switch To Comfortable View' : 'Switch To Compact View'}
            </button>

            <button
              type="button"
              onClick={() => setShowShortcutHelp(true)}
              className="mt-2 w-full rounded-lg border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-200"
            >
              Open Shortcut Guide
            </button>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => applyThemePreset('institutional')}
                className={
                  themePreset === 'institutional'
                    ? 'rounded-md border border-cyan-400/70 bg-cyan-500/20 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-300'
                }
              >
                Inst
              </button>
              <button
                type="button"
                onClick={() => applyThemePreset('high-contrast')}
                className={
                  themePreset === 'high-contrast'
                    ? 'rounded-md border border-cyan-400/70 bg-cyan-500/20 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-300'
                }
              >
                Contrast
              </button>
              <button
                type="button"
                onClick={() => applyThemePreset('compact-pro')}
                className={
                  themePreset === 'compact-pro'
                    ? 'rounded-md border border-cyan-400/70 bg-cyan-500/20 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
                    : 'rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-300'
                }
              >
                Compact
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showShortcutHelp ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShowShortcutHelp(false)}
        >
          <div
            className="terminal-card w-full max-w-2xl p-5 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Shortcut Guide</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Navigate Fast Across Modules</h2>
              </div>
              <button type="button" className="terminal-btn text-xs" onClick={() => setShowShortcutHelp(false)}>
                Close
              </button>
            </div>

            <p className="mt-2 text-sm text-zinc-400">
              Use <span className="shortcut-kbd">Alt+1 ... Alt+9</span> to switch modules. Press <span className="shortcut-kbd">Alt+K</span> or <span className="shortcut-kbd">?</span> to reopen this guide.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SHORTCUTS.map((item) => (
                <div key={item.key} className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                  <p className="text-xs text-zinc-400">
                    <span className="shortcut-kbd">{item.key}</span>
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-200">
                    {item.title}
                    {item.requiresAuth && !user ? ' (login required)' : ''}
                  </p>
                </div>
              ))}
            </div>
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
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="nav-code-pill">{item.short}</span>
                  <span>{item.label}</span>
                </span>
                <span className="text-[10px] text-zinc-500">{item.shortcutKey}</span>
              </div>
              <p className="mt-1 text-[11px] font-normal text-zinc-500">{item.description}</p>
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
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="nav-code-pill">{item.short}</span>
                  <span>{item.label} {user ? '' : '• login'}</span>
                </span>
                <span className="text-[10px] text-zinc-500">{item.shortcutKey}</span>
              </div>
              <p className="mt-1 text-[11px] font-normal text-zinc-500">{item.description}</p>
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

      <main className="px-3 pb-28 pt-24 sm:px-4 sm:pb-10 lg:ml-[20%] lg:px-8 lg:pb-8">
        <div className="mx-auto max-w-[1500px]">
          <section className="terminal-card mb-4 overflow-hidden p-4 sm:p-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_90%_12%,rgba(245,158,11,0.14),transparent_28%)]" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Current Module</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{currentRouteSummary.title}</h2>
                <p className="mt-1 max-w-2xl text-sm text-zinc-300">{currentRouteSummary.detail}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {allNav.slice(0, 5).map((item) => (
                  <NavLink
                    key={`quick-${item.to}`}
                    to={item.to}
                    end={item.end}
                    className={
                      isNavItemActive(location.pathname, item)
                        ? 'terminal-btn-primary text-xs'
                        : 'terminal-btn text-xs'
                    }
                  >
                    {item.short} {item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="terminal-pill">Shortcut: {activeNavItem?.shortcutKey ?? 'Alt+1'}</span>
              <span className="terminal-pill">{activeNavItem?.description ?? 'Navigate quickly across modules'}</span>
            </div>
          </section>

          {showHintCard && activeHint ? (
            <section className="terminal-card mb-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Quick Onboarding</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{activeHint.title}</h2>
                </div>
                <button
                  type="button"
                  className="terminal-btn text-xs"
                  onClick={() =>
                    setDismissedHints((prev) =>
                      activeHint && !prev.includes(activeHint.key) ? [...prev, activeHint.key] : prev,
                    )
                  }
                >
                  Got It
                </button>
              </div>

              <p className="mt-2 text-sm text-zinc-300">{activeHint.detail}</p>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {activeHint.tips.map((tip) => (
                  <div key={tip} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-400">
                    {tip}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {authChecking ? (
            <section className="terminal-card p-5 sm:p-6">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Workspace Loading</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="skeleton-block h-3 w-24" />
                  <div className="skeleton-block mt-3 h-7 w-28" />
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="skeleton-block h-3 w-20" />
                  <div className="skeleton-block mt-3 h-7 w-32" />
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="skeleton-block h-3 w-24" />
                  <div className="skeleton-block mt-3 h-7 w-24" />
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="skeleton-block h-3 w-40" />
                <div className="skeleton-block mt-2 h-3 w-full" />
                <div className="skeleton-block mt-2 h-3 w-10/12" />
              </div>
            </section>
          ) : (
            <Routes>
              <Route path="/" element={<ProDeskTerminalPage />} />
              <Route path="/execution" element={<CalculatorTerminalPage />} />
              <Route path="/live-market" element={<LiveMarketTerminalPage />} />
              <Route path="/floorsheet-lab" element={<FloorsheetTerminalPage />} />
              <Route path="/market-news" element={<MarketNewsTerminalPage />} />
              <Route path="/edge-suite" element={<EdgeSuiteTerminalPage user={user} />} />
              <Route path="/signal-dashboard" element={<Navigate to="/edge-suite" replace />} />
              <Route
                path="/chart-desk"
                element={
                  <ProtectedPage user={user}>
                    <Suspense
                      fallback={<div className="terminal-card p-6 text-sm text-zinc-400">Loading chart workspace...</div>}
                    >
                      <ChartDeskTerminalPage />
                    </Suspense>
                  </ProtectedPage>
                }
              />
              <Route
                path="/chart-desk/:symbol"
                element={
                  <ProtectedPage user={user}>
                    <Suspense
                      fallback={<div className="terminal-card p-6 text-sm text-zinc-400">Loading chart workspace...</div>}
                    >
                      <ChartDeskTerminalPage />
                    </Suspense>
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
                <p className="mt-2 text-sm text-zinc-300">Pro Desk, Execution, Market, Floorsheet Lab, Economy News, Trade + Signal Suite, Chart Lab, Portfolio, Journal</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Data Session</p>
                <p className="mt-2 text-sm text-zinc-300">Market: {marketStatus.label} • Source: {marketStatus.source}</p>
                <p className="text-xs text-zinc-500">{marketStatus.asOf ? `As of ${marketStatus.asOf}` : 'Awaiting source timestamp'}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
              <span className="terminal-pill">Shortcut Help: Alt+K</span>
              <button
                type="button"
                className="terminal-btn text-xs"
                onClick={() => setDismissedHints([])}
              >
                Show Onboarding Again
              </button>
            </div>
            <p className="mt-4 text-center text-xs uppercase tracking-[0.2em] text-zinc-500">
              Developed by InfoShare Company • Built for disciplined traders
            </p>
          </footer>
        </div>
      </main>

      {!mobileNavOpen ? (
        <nav className="fixed bottom-3 left-3 right-3 z-50 rounded-2xl border border-zinc-700/80 bg-zinc-950/90 p-2 shadow-terminal backdrop-blur-xl lg:hidden">
          <div className="grid grid-cols-5 gap-2">
            {mobileDockNav.map((item) => (
              <NavLink
                key={`dock-${item.to}`}
                to={item.to}
                end={item.end}
                className={
                  isNavItemActive(location.pathname, item)
                    ? 'rounded-xl border border-cyan-300/70 bg-cyan-500/15 px-2 py-2 text-center text-[11px] font-semibold text-cyan-100'
                    : 'rounded-xl border border-zinc-700/80 bg-zinc-900/75 px-2 py-2 text-center text-[11px] font-semibold text-zinc-300'
                }
              >
                <p className="font-mono text-[10px] tracking-wide">{item.short}</p>
                <p className="mt-0.5 truncate">{item.label}</p>
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
