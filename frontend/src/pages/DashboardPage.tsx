const cards = [
  { title: 'Your profit this FY', value: 'NPR 82,410', tone: 'up' },
  { title: 'CGT paid this FY', value: 'NPR 6,245', tone: 'flat' },
  { title: 'CGT saved >365d', value: 'NPR 2,120', tone: 'up' },
  { title: 'Paper portfolio delta', value: '+5.8%', tone: 'up' },
];

export function DashboardPage() {
  return (
    <section className="grid-layout">
      <article className="panel hero">
        <h1>NEPSE Personal Trading Workspace</h1>
        <p>Calculator, journal, watchlist, paper-trading, and strategy view in one focused cockpit.</p>
      </article>
      {cards.map((card) => (
        <article key={card.title} className="panel metric-card">
          <p>{card.title}</p>
          <h3 className={card.tone === 'up' ? 'up' : ''}>{card.value}</h3>
        </article>
      ))}
      <article className="panel index-strip">
        <h2>Indices</h2>
        <div className="index-row">
          <span>NEPSE</span>
          <strong>2,118.40</strong>
          <span className="up">+0.82%</span>
        </div>
        <div className="index-row">
          <span>Banking</span>
          <strong>1,367.22</strong>
          <span className="down">-0.21%</span>
        </div>
        <div className="index-row">
          <span>Hydro</span>
          <strong>2,545.80</strong>
          <span className="up">+1.19%</span>
        </div>
      </article>
    </section>
  );
}
