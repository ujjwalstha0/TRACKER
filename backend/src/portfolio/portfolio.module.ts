import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeesModule } from '../fees/fees.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [FeesModule, AuthModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
