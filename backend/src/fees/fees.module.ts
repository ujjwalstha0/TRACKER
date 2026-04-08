import { Module } from '@nestjs/common';
import { FeesService } from './fees.service';
import { FeesController } from './fees.controller';
import { PublicCalcController } from './public-calc.controller';

@Module({
  providers: [FeesService],
  controllers: [FeesController, PublicCalcController],
  exports: [FeesService],
})
export class FeesModule {}
