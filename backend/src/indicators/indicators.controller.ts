import { Controller, Get, Query } from '@nestjs/common';
import { IndicatorsService } from './indicators.service';

@Controller('indicators')
export class IndicatorsController {
  constructor(private readonly indicatorsService: IndicatorsService) {}

  @Get()
  findAll(
    @Query('symbol') symbol?: string,
    @Query('interval') interval?: string,
    @Query('limit') limit?: string,
  ) {
    return this.indicatorsService.getIndicators({
      symbol: symbol ?? '',
      interval,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
