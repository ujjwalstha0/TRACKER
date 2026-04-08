import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUserPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTradeDto } from './dto/create-trade.dto';
import { TradeEntity } from './trade.entity';
import { TradesService } from './trades.service';

@Controller('trades')
@UseGuards(JwtAuthGuard)
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  create(@CurrentUser() user: AuthUserPayload, @Body() dto: CreateTradeDto): Promise<TradeEntity> {
    return this.tradesService.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUserPayload, @Query('isBuy') isBuy?: string): Promise<TradeEntity[]> {
    const parsed = typeof isBuy === 'string'
      ? isBuy.toLowerCase() === 'true'
        ? true
        : isBuy.toLowerCase() === 'false'
          ? false
          : undefined
      : undefined;
    return this.tradesService.findAll(user.userId, parsed);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUserPayload, @Param('id', ParseIntPipe) id: number): Promise<TradeEntity> {
    return this.tradesService.findOne(user.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUserPayload, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.tradesService.remove(user.userId, id);
  }
}
