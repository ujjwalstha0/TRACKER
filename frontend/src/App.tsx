import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BuySellCalculator } from './components/BuySellCalculator';
import { PLSimulator } from './components/PLSimulator';

const THEME_KEY = 'nepse.personal-calculator.theme';

export default function App() {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem(THEME_KEY) !== 'light');

  useEffect(() => {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className={dark ? 'app-shell theme-dark' : 'app-shell'}>
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-tag">NEPSE EXECUTION DESK</span>
          <h1>Personal Trade Cost & Exit Simulator</h1>
          <p>Professional buy/sell cost clarity and target/stop-loss outcome preview for equity trades.</p>
        </div>
        <button className="theme-btn" onClick={() => setDark((v) => !v)} type="button">
          {dark ? 'Light Mode' : 'Dark Mode'}
        </button>
      </header>

      <nav className="tab-nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          Buy/Sell Calculator
        </NavLink>
        <NavLink to="/pl-simulator" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          P/L Simulator
        </NavLink>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<BuySellCalculator />} />
          <Route path="/pl-simulator" element={<PLSimulator />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
