import { Controller, Get, Param, Query } from '@nestjs/common';
import { SignalService } from './signal.service';

@Controller('signal')
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  @Get()
  findByQuery(@Query('symbol') symbol?: string) {
    return this.signalService.calculateSignal(symbol ?? '');
  }

  @Get(':symbol')
  findByParam(@Param('symbol') symbol: string) {
    return this.signalService.calculateSignal(symbol);
  }
}
