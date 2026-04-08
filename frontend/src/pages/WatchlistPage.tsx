import { WatchlistTable } from '../components/WatchlistTable';
import { WatchlistItem } from '../types';

const seed: WatchlistItem[] = [
  {
    symbol: 'NABIL',
    sector: 'Commercial Bank',
    buyPrice: 510,
    currentPrice: 550,
    quantity: 100,
    listingType: 'listed',
    targetPrice: 585,
    stopLoss: 532,
    momentum: 8.6,
    catalyst: 'Quarterly earnings momentum',
  },
  {
    symbol: 'NICA',
    sector: 'Commercial Bank',
    buyPrice: 420,
    currentPrice: 405,
    quantity: 150,
    listingType: 'listed',
    targetPrice: 440,
    stopLoss: 392,
    momentum: 5.1,
    catalyst: 'Range breakout watch',
  },
  {
    symbol: 'UPPER',
    sector: 'Hydropower',
    buyPrice: 310,
    currentPrice: 345,
    quantity: 220,
    listingType: 'listed',
    targetPrice: 372,
    stopLoss: 332,
    momentum: 9.3,
    catalyst: 'Sector rotation into hydro',
  },
];

export function WatchlistPage() {
  return <WatchlistTable rows={seed} />;
}
