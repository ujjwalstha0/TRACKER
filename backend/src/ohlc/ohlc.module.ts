import { Module } from '@nestjs/common';
import { OhlcController } from './ohlc.controller';
import { OhlcService } from './ohlc.service';

@Module({
  controllers: [OhlcController],
  providers: [OhlcService],
  exports: [OhlcService],
})
export class OhlcModule {}
