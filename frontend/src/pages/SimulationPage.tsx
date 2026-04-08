export function SimulationPage() {
  return (
    <section className="grid-layout">
      <article className="panel metric-card">
        <p>Virtual Capital</p>
        <h3>NPR 500,000</h3>
      </article>
      <article className="panel metric-card">
        <p>Real Portfolio Return</p>
        <h3 className="up">+8.20%</h3>
      </article>
      <article className="panel metric-card">
        <p>Paper Portfolio Return</p>
        <h3 className="up">+13.90%</h3>
      </article>
      <article className="panel">
        <h2>Strategy Testing Helper</h2>
        <p>Rules: EMA cross, RSI {'<'} 30, time-based exits.</p>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Symbol</th>
              <th>P&L</th>
              <th>Win Rate</th>
              <th>Avg Win/Loss</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>EMA(9/21) cross</td>
              <td>NABIL</td>
              <td className="up">+24,200</td>
              <td>57.1%</td>
              <td>1.48</td>
            </tr>
            <tr>
              <td>RSI {'<'} 30 + 10-day exit</td>
              <td>UPPER</td>
              <td className="up">+18,090</td>
              <td>54.8%</td>
              <td>1.33</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>
  );
}
