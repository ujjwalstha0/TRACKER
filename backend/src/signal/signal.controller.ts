import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SignalService } from './signal.service';

@Controller('signal')
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  @Get()
  findByQuery(@Query('symbol') symbol?: string) {
    return this.signalService.calculateSignal(symbol ?? '');
  }

  @Post('notebook/generate')
  generateNotebook(@Body() body?: { limit?: number }) {
    return this.signalService.generateDailyNotebook(body?.limit);
  }

  @Get('notebook/today')
  getTodayNotebook() {
    return this.signalService.getTodayNotebook();
  }

  @Post('notebook/evaluate-close')
  evaluateNotebookClose() {
    return this.signalService.evaluateTodayNotebookClose();
  }

  @Get(':symbol')
  findByParam(@Param('symbol') symbol: string) {
    return this.signalService.calculateSignal(symbol);
  }
}
