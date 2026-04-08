import { NavLink, Route, Routes } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { CalculatorPage } from './pages/CalculatorPage';
import { DashboardPage } from './pages/DashboardPage';
import { JournalPage } from './pages/JournalPage';
import { SimulationPage } from './pages/SimulationPage';
import { WatchlistPage } from './pages/WatchlistPage';

const links = [
  { to: '/dashboard', label: 'Market Board', short: 'MB' },
  { to: '/calculator', label: 'Brokerage Lab', short: 'BL' },
  { to: '/journal', label: 'Execution Journal', short: 'EJ' },
  { to: '/watchlist', label: 'Setup Radar', short: 'SR' },
  { to: '/simulation', label: 'Battle Simulator', short: 'BS' },
];

const defaultHolidays = ['2026-01-01', '2026-03-14', '2026-10-24'];
const holidayStorageKey = 'nepse.custom.holidays.v1';
const riskStorageKey = 'nepse.daily.risk.lock.v1';

interface RiskState {
  dailyPnl: number;
  maxLoss: number;
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [holidayInput, setHolidayInput] = useState('');
  const [customHolidays, setCustomHolidays] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(holidayStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const [risk, setRisk] = useState<RiskState>(() => {
    try {
      const raw = localStorage.getItem(riskStorageKey);
      if (!raw) return { dailyPnl: 0, maxLoss: 10000 };
      const parsed = JSON.parse(raw) as Partial<RiskState>;
      return {
        dailyPnl: Number(parsed.dailyPnl ?? 0),
        maxLoss: Math.max(1, Number(parsed.maxLoss ?? 10000)),
      };
    } catch {
      return { dailyPnl: 0, maxLoss: 10000 };
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(holidayStorageKey, JSON.stringify(customHolidays));
  }, [customHolidays]);

  useEffect(() => {
    localStorage.setItem(riskStorageKey, JSON.stringify(risk));
  }, [risk]);

  const marketContext = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kathmandu',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = Number(map.hour ?? '0');
    const minute = Number(map.minute ?? '0');
    const nepalTime = `${map.hour}:${map.minute}:${map.second} NPT`;
    const nepalDate = `${map.day}/${map.month}/${map.year}`;
    const weekday = map.weekday ?? '';
    const totalMinute = hour * 60 + minute;
    const isTradingDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday);
    const todayIso = `${map.year}-${map.month}-${map.day}`;
    const isHoliday = [...defaultHolidays, ...customHolidays].includes(todayIso);
    const isOpen = isTradingDay && !isHoliday && totalMinute >= 660 && totalMinute < 900;

    return {
      nepalTime,
      nepalDate,
      session: totalMinute < 660 ? 'Pre-Market Prep' : totalMinute < 900 ? 'Live Session' : 'Post-Market Review',
      marketStatus: isOpen ? 'Market Open' : isHoliday ? 'Market Closed (Holiday)' : 'Market Closed',
      marketOpenClass: isOpen ? 'chip-open' : 'chip-closed',
      todayIso,
      isHoliday,
    };
  }, [customHolidays, now]);

  const tradeLocked = risk.dailyPnl <= -Math.abs(risk.maxLoss);

  const addHoliday = () => {
    if (!holidayInput || customHolidays.includes(holidayInput)) return;
    setCustomHolidays((old) => [...old, holidayInput].sort());
    setHolidayInput('');
  };

  const removeHoliday = (value: string) => {
    setCustomHolidays((old) => old.filter((x) => x !== value));
  };

  return (
    <div className={dark ? 'app theme-dark' : 'app theme-light'}>
      <aside className="sidebar">
        <div className="brand">
          <p>NEPSE TRADER</p>
          <h2>Conviction Desk</h2>
          <small>Discipline over dopamine</small>
        </div>

        <nav>
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span>{link.short}</span>
              <strong>{link.label}</strong>
            </NavLink>
          ))}
        </nav>

        <button className="mode-toggle" onClick={() => setDark((v) => !v)}>
          {dark ? 'Use Day Screen' : 'Use Night Screen'}
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar panel">
          <div>
            <h1>NEPSE Trading Command Center</h1>
            <p>Plan entries, quantify risk, and review execution quality every single day.</p>
          </div>
          <div className="status-chips">
            <span className={`chip ${marketContext.marketOpenClass}`}>{marketContext.marketStatus}</span>
            <span className="chip">Session: {marketContext.session}</span>
            <span className="chip chip-muted">NPT: {marketContext.nepalTime}</span>
            <span className="chip chip-muted">Date: {marketContext.nepalDate}</span>
            <span className={`chip ${tradeLocked ? 'chip-closed' : 'chip-open'}`}>{tradeLocked ? 'Trade Lock Active' : 'Trade Lock Inactive'}</span>
          </div>
          <div className="controls-grid">
            <label>
              Today P&L (NPR)
              <input type="number" value={risk.dailyPnl} onChange={(e) => setRisk({ ...risk, dailyPnl: Number(e.target.value) })} />
            </label>
            <label>
              Max Daily Loss (NPR)
              <input type="number" value={risk.maxLoss} min={1} onChange={(e) => setRisk({ ...risk, maxLoss: Math.max(1, Number(e.target.value)) })} />
            </label>
            <label>
              Add Holiday (YYYY-MM-DD)
              <div className="inline-input">
                <input type="date" value={holidayInput} onChange={(e) => setHolidayInput(e.target.value)} />
                <button className="cta" type="button" onClick={addHoliday}>
                  Add
                </button>
              </div>
            </label>
            <div className="holiday-wrap">
              {[...defaultHolidays, ...customHolidays].map((date) => {
                const isCustom = customHolidays.includes(date);
                return (
                  <span key={date} className="holiday-chip">
                    {date}
                    {isCustom ? (
                      <button type="button" onClick={() => removeHoliday(date)}>
                        x
                      </button>
                    ) : null}
                  </span>
                );
              })}
              <span className="muted-mini">Today: {marketContext.todayIso}{marketContext.isHoliday ? ' (holiday)' : ''}</span>
            </div>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calculator" element={<CalculatorPage tradeLocked={tradeLocked} />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/simulation" element={<SimulationPage tradeLocked={tradeLocked} />} />
          </Routes>
        </main>
      </section>
    </div>
  );
}
