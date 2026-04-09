import { registerAs } from '@nestjs/config';

export interface ScrapeConfig {
  todayPriceUrl: string;
  liveTradingUrl: string;
  priceIntervalMillis: number;
  indexIntervalMillis: number;
}

const DEFAULT_TODAY_PRICE_URL = 'https://www.sharesansar.com/today-share-price';
const DEFAULT_LIVE_TRADING_URL = 'https://www.sharesansar.com/live-trading';
const DEFAULT_PRICE_INTERVAL_MILLIS = 15_000;
const DEFAULT_INDEX_INTERVAL_MILLIS = 15_000;
const MIN_INTERVAL_MILLIS = 5_000;
const MAX_INTERVAL_MILLIS = 15_000;

function toBoundedInterval(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(MIN_INTERVAL_MILLIS, Math.min(MAX_INTERVAL_MILLIS, Math.floor(parsed)));
}

export default registerAs('scrape', (): ScrapeConfig => {
  const todayPriceUrl = process.env.SCRAPING_TODAY_PRICE_URL?.trim() || DEFAULT_TODAY_PRICE_URL;
  const liveTradingUrl = process.env.SCRAPING_LIVE_TRADING_URL?.trim() || DEFAULT_LIVE_TRADING_URL;

  return {
    todayPriceUrl,
    liveTradingUrl,
    priceIntervalMillis: toBoundedInterval(process.env.SCRAPING_PRICE_INTERVAL_MILLIS, DEFAULT_PRICE_INTERVAL_MILLIS),
    indexIntervalMillis: toBoundedInterval(process.env.SCRAPING_INDEX_INTERVAL_MILLIS, DEFAULT_INDEX_INTERVAL_MILLIS),
  };
});
