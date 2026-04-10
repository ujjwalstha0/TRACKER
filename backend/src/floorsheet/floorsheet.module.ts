import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FloorsheetController } from './floorsheet.controller';
import { FloorsheetService } from './floorsheet.service';

@Module({
  imports: [PrismaModule],
  controllers: [FloorsheetController],
  providers: [FloorsheetService],
  exports: [FloorsheetService],
})
export class FloorsheetModule {}