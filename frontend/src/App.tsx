import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BuySellCalculator } from './components/BuySellCalculator';
import { LiveMarketBoard } from './components/LiveMarketBoard';
import { PLSimulator } from './components/PLSimulator';

const THEME_KEY = 'nepse.personal-calculator.theme';

export default function App() {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem(THEME_KEY) !== 'light');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className={dark ? 'app-shell theme-dark' : 'app-shell'}>
      <header className="top-nav card-lite">
        <div className="brand-block">
          <span className="brand-tag">NEPSE EXECUTION DESK</span>
          <strong>Personal Trade Cost Terminal</strong>
          <small>Clarity over noise, process over impulse.</small>
        </div>
        <nav className="tab-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            Buy/Sell Calculator
          </NavLink>
          <NavLink to="/live-market" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            Live Market
          </NavLink>
          <NavLink to="/pl-simulator" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            P/L Simulator
          </NavLink>
        </nav>

        <div className="top-meta">
          <span>{now.toLocaleString()}</span>
          <button className="theme-btn" onClick={() => setDark((v) => !v)} type="button">
            {dark ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </header>

      <section className="hero-head card-lite">
        <div>
          <p className="hero-kicker">Built To Beat Information Overload</p>
          <h1>Read The Market Fast. Execute With Conviction.</h1>
          <p>Live pulse, transparent fee math, and practical scenario planning in one focused interface.</p>
        </div>

        <div className="hero-points">
          <article className="hero-chip">
            <strong>Live Pulse</strong>
            <span>Top movers and indices at a glance.</span>
          </article>
          <article className="hero-chip">
            <strong>Cost Clarity</strong>
            <span>Exact broker, SEBON, DP, and CGT impact.</span>
          </article>
          <article className="hero-chip">
            <strong>Decision Discipline</strong>
            <span>Target and stop-loss outcomes before execution.</span>
          </article>
        </div>
      </section>

      <main>
        <Routes>
          <Route path="/" element={<BuySellCalculator />} />
          <Route path="/live-market" element={<LiveMarketBoard />} />
          <Route path="/pl-simulator" element={<PLSimulator />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="app-footer card-lite">
        <span>Private use only • Backend-only scraping • Data updates by your own VPS jobs</span>
        <span>Built for NEPSE equity execution decisions • Focus. Plan. Execute.</span>
      </footer>
    </div>
  );
}
