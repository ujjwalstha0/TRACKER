import { Module } from '@nestjs/common';
import { OhlcBackfillService } from './ohlc.backfill.service';
import { OhlcController } from './ohlc.controller';
import { OhlcService } from './ohlc.service';

@Module({
  controllers: [OhlcController],
  providers: [OhlcService, OhlcBackfillService],
  exports: [OhlcService],
})
export class OhlcModule {}
