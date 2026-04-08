import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NepseScrapeService } from './nepse-scrape.service';
import { Inject } from '@nestjs/common';
import scrapeConfig from '../config/scrape.config';
import { ConfigType } from '@nestjs/config';

@Injectable()
export class ScrapeRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScrapeRunnerService.name);
  private priceTimer: NodeJS.Timeout | null = null;
  private indexTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly scrapeService: NepseScrapeService,
    @Inject(scrapeConfig.KEY)
    private readonly config: ConfigType<typeof scrapeConfig>,
  ) {}

  onModuleInit(): void {
    void this.runPriceCycle();
    void this.runIndexCycle();

    this.priceTimer = setInterval(() => {
      void this.runPriceCycle();
    }, this.config.priceIntervalMillis);

    this.indexTimer = setInterval(() => {
      void this.runIndexCycle();
    }, this.config.indexIntervalMillis);

    this.logger.log(
      `Scraping jobs started: prices=${this.config.priceIntervalMillis}ms indices=${this.config.indexIntervalMillis}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.priceTimer) clearInterval(this.priceTimer);
    if (this.indexTimer) clearInterval(this.indexTimer);
  }

  private async runPriceCycle(): Promise<void> {
    try {
      const prices = await this.scrapeService.scrapeTodayPrices();
      await this.scrapeService.savePricesToDb(prices);
      this.logger.log(`Saved ${prices.length} price rows`);
    } catch (error) {
      this.logger.error('Price scrape cycle failed', error instanceof Error ? error.stack : undefined);
    }
  }

  private async runIndexCycle(): Promise<void> {
    try {
      const indices = await this.scrapeService.scrapeIndices();
      await this.scrapeService.saveIndicesToDb(indices);
      this.logger.log(`Saved ${indices.length} index rows`);
    } catch (error) {
      this.logger.error('Index scrape cycle failed', error instanceof Error ? error.stack : undefined);
    }
  }
}
