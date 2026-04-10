import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUserPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateIpoAlertStatusDto } from './dto/update-ipo-alert-status.dto';
import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get('economy-market')
  getEconomyMarketNews(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.newsService.getEconomicMarketNews(parsedLimit);
  }

  @Get('live-prices')
  getLivePrices() {
    return this.newsService.getNepalLivePrices();
  }

  @Get('ipo-alerts/applied')
  @UseGuards(JwtAuthGuard)
  getAppliedIpoAlerts(@CurrentUser() user: AuthUserPayload) {
    return this.newsService.getAppliedIpoAlerts(user.userId);
  }

  @Post('ipo-alerts/apply')
  @UseGuards(JwtAuthGuard)
  markIpoApplied(@CurrentUser() user: AuthUserPayload, @Body() dto: UpdateIpoAlertStatusDto) {
    return this.newsService.markIpoApplied(user.userId, dto.ipoAlertId);
  }

  @Post('ipo-alerts/pending')
  @UseGuards(JwtAuthGuard)
  markIpoPending(@CurrentUser() user: AuthUserPayload, @Body() dto: UpdateIpoAlertStatusDto) {
    return this.newsService.markIpoPending(user.userId, dto.ipoAlertId);
  }
}
