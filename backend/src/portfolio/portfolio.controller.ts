import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUserPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateHoldingDto } from './dto/create-holding.dto';
import { UpdateHoldingDto } from './dto/update-holding.dto';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('holdings')
  findAll(@CurrentUser() user: AuthUserPayload) {
    return this.portfolioService.findAll(user.userId);
  }

  @Post('holdings')
  create(@CurrentUser() user: AuthUserPayload, @Body() dto: CreateHoldingDto) {
    return this.portfolioService.create(user.userId, dto);
  }

  @Patch('holdings/:id')
  update(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHoldingDto,
  ) {
    return this.portfolioService.update(user.userId, id, dto);
  }

  @Delete('holdings/:id')
  remove(@CurrentUser() user: AuthUserPayload, @Param('id', ParseIntPipe) id: number) {
    return this.portfolioService.remove(user.userId, id);
  }
}
