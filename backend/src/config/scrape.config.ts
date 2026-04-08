import { registerAs } from '@nestjs/config';

export interface ScrapeConfig {
  todayPriceUrl: string;
  liveTradingUrl: string;
  priceIntervalMillis: number;
  indexIntervalMillis: number;
}

const DEFAULT_TODAY_PRICE_URL = 'https://www.sharesansar.com/today-share-price';
const DEFAULT_LIVE_TRADING_URL = 'https://www.sharesansar.com/live-trading';
const DEFAULT_INTERVAL_MILLIS = 60_000;

function toPositiveNumberOrDefault(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export default registerAs('scrape', (): ScrapeConfig => {
  const todayPriceUrl = process.env.SCRAPING_TODAY_PRICE_URL?.trim() || DEFAULT_TODAY_PRICE_URL;
  const liveTradingUrl = process.env.SCRAPING_LIVE_TRADING_URL?.trim() || DEFAULT_LIVE_TRADING_URL;

  return {
    todayPriceUrl,
    liveTradingUrl,
    priceIntervalMillis: toPositiveNumberOrDefault(process.env.SCRAPING_PRICE_INTERVAL_MILLIS, DEFAULT_INTERVAL_MILLIS),
    indexIntervalMillis: toPositiveNumberOrDefault(process.env.SCRAPING_INDEX_INTERVAL_MILLIS, DEFAULT_INTERVAL_MILLIS),
  };
});
