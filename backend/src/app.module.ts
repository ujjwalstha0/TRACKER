import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import scrapeConfig from './config/scrape.config';
import { FeesModule } from './fees/fees.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { IndicesModule } from './indices/indices.module';
import { OhlcModule } from './ohlc/ohlc.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { ScrapeModule } from './scrape/scrape.module';
import { SimulationModule } from './simulation/simulation.module';
import { TradeEntity } from './trades/trade.entity';
import { TradesModule } from './trades/trades.module';
import { WatchlistModule } from './watchlist/watchlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [scrapeConfig],
    }),
    PrismaModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'nepse_tracker',
      entities: [TradeEntity],
      synchronize: false,
    }),
    FeesModule,
    AuthModule,
    PortfolioModule,
    TradesModule,
    WatchlistModule,
    IndicesModule,
    OhlcModule,
    IndicatorsModule,
    ScrapeModule,
    SimulationModule,
    ReportsModule,
  ],
})
export class AppModule {}
