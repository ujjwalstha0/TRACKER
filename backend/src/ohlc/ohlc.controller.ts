import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OhlcBackfillService } from './ohlc.backfill.service';
import { OhlcService } from './ohlc.service';
import { OhlcBackfillRequest } from './ohlc.types';

@Controller('ohlc')
export class OhlcController {
  constructor(
    private readonly ohlcService: OhlcService,
    private readonly ohlcBackfillService: OhlcBackfillService,
  ) {}

  @Get()
  findAll(
    @Query('symbol') symbol?: string,
    @Query('interval') interval?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ohlcService.getCandles({
      symbol: symbol ?? '',
      interval,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('backfill/start')
  startBackfill(@Body() body?: OhlcBackfillRequest) {
    return this.ohlcBackfillService.startAllSymbolsBackfill(body);
  }

  @Get('backfill/status')
  getBackfillStatus() {
    return this.ohlcBackfillService.getBackfillStatus();
  }

  @Post('backfill/symbol/:symbol')
  backfillSymbol(
    @Param('symbol') symbol: string,
    @Body() body?: OhlcBackfillRequest,
  ) {
    return this.ohlcBackfillService.backfillSingleSymbol(symbol, body);
  }
}
