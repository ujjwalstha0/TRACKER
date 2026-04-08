import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesModule } from '../fees/fees.module';
import { TradeEntity } from './trade.entity';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';

@Module({
  imports: [TypeOrmModule.forFeature([TradeEntity]), FeesModule],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
