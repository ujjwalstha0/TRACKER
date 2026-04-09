import { Controller, Get } from '@nestjs/common';
import { NepseScrapeService } from './nepse-scrape.service';
import { MarketStatusDto } from './scrape.types';

@Controller('market')
export class MarketStatusController {
  constructor(private readonly scrapeService: NepseScrapeService) {}

  @Get('status')
  async getStatus(): Promise<MarketStatusDto> {
    return this.scrapeService.scrapeMarketStatus();
  }
}
