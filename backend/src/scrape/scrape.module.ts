import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import scrapeConfig from '../config/scrape.config';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketStatusController } from './market-status.controller';
import { NepseScrapeService } from './nepse-scrape.service';
import { ScrapeRunnerService } from './scrape.runner.service';

@Module({
  imports: [PrismaModule, ConfigModule.forFeature(scrapeConfig)],
  controllers: [MarketStatusController],
  providers: [NepseScrapeService, ScrapeRunnerService],
  exports: [NepseScrapeService],
})
export class ScrapeModule {}
