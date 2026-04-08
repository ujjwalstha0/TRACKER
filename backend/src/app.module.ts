import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesModule } from './fees/fees.module';
import { ReportsModule } from './reports/reports.module';
import { SimulationModule } from './simulation/simulation.module';
import { TradeEntity } from './trades/trade.entity';
import { TradesModule } from './trades/trades.module';
import { WatchlistModule } from './watchlist/watchlist.module';

@Module({
  imports: [
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
    TradesModule,
    WatchlistModule,
    SimulationModule,
    ReportsModule,
  ],
})
export class AppModule {}
