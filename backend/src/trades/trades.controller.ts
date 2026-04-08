import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CreateTradeDto } from './dto/create-trade.dto';
import { TradeEntity } from './trade.entity';
import { TradesService } from './trades.service';

@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  create(@Body() dto: CreateTradeDto): Promise<TradeEntity> {
    return this.tradesService.create(dto);
  }

  @Get()
  findAll(): Promise<TradeEntity[]> {
    return this.tradesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TradeEntity> {
    return this.tradesService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.tradesService.remove(id);
  }
}
