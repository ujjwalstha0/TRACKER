import { Controller, Get, Query } from '@nestjs/common';
import { OhlcService } from './ohlc.service';

@Controller('ohlc')
export class OhlcController {
  constructor(private readonly ohlcService: OhlcService) {}

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
}
