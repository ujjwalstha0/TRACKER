import { WatchlistTable } from '../components/WatchlistTable';
import { WatchlistItem } from '../types';

const seed: WatchlistItem[] = [
  { symbol: 'NABIL', sector: 'Commercial Bank', buyPrice: 510, currentPrice: 550, quantity: 100, listingType: 'listed' },
  { symbol: 'NICA', sector: 'Commercial Bank', buyPrice: 420, currentPrice: 405, quantity: 150, listingType: 'listed' },
  { symbol: 'UPPER', sector: 'Hydropower', buyPrice: 310, currentPrice: 345, quantity: 220, listingType: 'listed' },
];

export function WatchlistPage() {
  return <WatchlistTable rows={seed} />;
}
