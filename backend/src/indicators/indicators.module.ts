import { Module } from '@nestjs/common';
import { OhlcModule } from '../ohlc/ohlc.module';
import { IndicatorsController } from './indicators.controller';
import { IndicatorsService } from './indicators.service';

@Module({
  imports: [OhlcModule],
  controllers: [IndicatorsController],
  providers: [IndicatorsService],
})
export class IndicatorsModule {}
