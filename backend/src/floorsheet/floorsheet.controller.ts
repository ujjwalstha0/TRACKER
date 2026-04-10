import { Controller, Get, Param, Query } from '@nestjs/common';
import { FloorsheetService } from './floorsheet.service';

@Controller('floorsheet')
export class FloorsheetController {
  constructor(private readonly floorsheetService: FloorsheetService) {}

  @Get('desk')
  getDesk(@Query('symbols') symbols?: string, @Query('rows') rows?: string) {
    const parsedSymbols = symbols ? Number(symbols) : undefined;
    const parsedRows = rows ? Number(rows) : undefined;

    return this.floorsheetService.getDesk(parsedSymbols, parsedRows);
  }

  @Get('symbol/:symbol')
  getSymbol(
    @Param('symbol') symbol: string,
    @Query('rows') rows?: string,
    @Query('buyer') buyer?: string,
    @Query('seller') seller?: string,
  ) {
    const parsedRows = rows ? Number(rows) : undefined;
    return this.floorsheetService.getSymbol(symbol, parsedRows, buyer, seller);
  }
}