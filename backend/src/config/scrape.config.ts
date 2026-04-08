import { registerAs } from '@nestjs/config';

export interface ScrapeConfig {
  todayPriceUrl: string;
  liveTradingUrl: string;
  priceIntervalMillis: number;
  indexIntervalMillis: number;
}

function toNumber(name: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
}

export default registerAs('scrape', (): ScrapeConfig => {
  const todayPriceUrl = process.env.SCRAPING_TODAY_PRICE_URL;
  const liveTradingUrl = process.env.SCRAPING_LIVE_TRADING_URL;

  if (!todayPriceUrl || !liveTradingUrl) {
    throw new Error('SCRAPING_TODAY_PRICE_URL and SCRAPING_LIVE_TRADING_URL are required');
  }

  return {
    todayPriceUrl,
    liveTradingUrl,
    priceIntervalMillis: toNumber('SCRAPING_PRICE_INTERVAL_MILLIS', process.env.SCRAPING_PRICE_INTERVAL_MILLIS),
    indexIntervalMillis: toNumber('SCRAPING_INDEX_INTERVAL_MILLIS', process.env.SCRAPING_INDEX_INTERVAL_MILLIS),
  };
});
