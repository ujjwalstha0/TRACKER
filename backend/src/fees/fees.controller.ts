import { Body, Controller, Post } from '@nestjs/common';
import { FeeCalculationInput, FeeBreakdown } from './fees.types';
import { FeesService } from './fees.service';

@Controller('fees')
export class FeesController {
  constructor(private readonly feesService: FeesService) {}

  @Post('calculate')
  calculate(@Body() input: FeeCalculationInput): FeeBreakdown {
    return this.feesService.calculate(input);
  }
}
