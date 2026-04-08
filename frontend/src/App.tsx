import { Route, Routes } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { CalculatorPage } from './pages/CalculatorPage';

export default function App() {
  const [dark, setDark] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const nepalNow = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now),
    [now],
  );

  return (
    <div className={dark ? 'app theme-dark' : 'app theme-light'}>
      <aside className="sidebar">
        <div className="brand">
          <p>NEPSE COST DESK</p>
          <h2>Buy/Sell Charge Calculator</h2>
          <small>Know your true net before placing the order</small>
        </div>

        <button className="mode-toggle" onClick={() => setDark((v) => !v)}>
          {dark ? 'Use Day Screen' : 'Use Night Screen'}
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar panel">
          <div>
            <h1>NEPSE Trade Cost Terminal</h1>
            <p>Single focus: exact money required to buy and exact net proceeds after selling.</p>
          </div>
          <div className="status-chips">
            <span className="chip">NPT: {nepalNow}</span>
            <span className="chip chip-muted">Broker + SEBON + DP + CGT included</span>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<CalculatorPage />} />
            <Route path="*" element={<CalculatorPage />} />
          </Routes>
        </main>
      </section>
    </div>
  );
}
