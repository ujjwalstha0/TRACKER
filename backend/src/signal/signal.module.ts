import { Module } from '@nestjs/common';
import { OhlcModule } from '../ohlc/ohlc.module';
import { SignalController } from './signal.controller';
import { SignalService } from './signal.service';

@Module({
  imports: [OhlcModule],
  controllers: [SignalController],
  providers: [SignalService],
  exports: [SignalService],
})
export class SignalModule {}
