import { NavLink, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { CalculatorPage } from './pages/CalculatorPage';
import { DashboardPage } from './pages/DashboardPage';
import { JournalPage } from './pages/JournalPage';
import { SimulationPage } from './pages/SimulationPage';
import { WatchlistPage } from './pages/WatchlistPage';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/calculator', label: 'Calculator' },
  { to: '/journal', label: 'Journal' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/simulation', label: 'Simulation' },
];

export default function App() {
  const [dark, setDark] = useState(true);

  return (
    <div className={dark ? 'app theme-dark' : 'app theme-light'}>
      <aside className="sidebar">
        <div className="brand">
          <p>NEPSE</p>
          <h2>Trader Workspace</h2>
        </div>

        <nav>
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <button className="mode-toggle" onClick={() => setDark((v) => !v)}>
          {dark ? 'Switch to Light' : 'Switch to Dark'}
        </button>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/calculator" element={<CalculatorPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/simulation" element={<SimulationPage />} />
        </Routes>
      </main>
    </div>
  );
}
