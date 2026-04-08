import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BuySellCalculator } from './components/BuySellCalculator';
import { LiveMarketBoard } from './components/LiveMarketBoard';
import { PLSimulator } from './components/PLSimulator';

const THEME_KEY = 'nepse.personal-calculator.theme';

export default function App() {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem(THEME_KEY) !== 'light');

  useEffect(() => {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className={dark ? 'app-shell theme-dark' : 'app-shell'}>
      <header className="top-nav card-lite">
        <div className="brand-block">
          <span className="brand-tag">NEPSE EXECUTION DESK</span>
          <strong>Personal Trade Cost Terminal</strong>
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
        <button className="theme-btn" onClick={() => setDark((v) => !v)} type="button">
          {dark ? 'Light Mode' : 'Dark Mode'}
        </button>
      </header>

      <section className="hero-head">
        <h1>Personal Trade Cost & Exit Simulator</h1>
        <p>Professional buy/sell clarity with detailed charge math and scenario outcomes for equity trades.</p>
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
        <span>Built for NEPSE equity execution decisions</span>
      </footer>
    </div>
  );
}
