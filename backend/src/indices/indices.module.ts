import { Module } from '@nestjs/common';
import { IndicesController } from './indices.controller';
import { IndicesService } from './indices.service';

@Module({
  controllers: [IndicesController],
  providers: [IndicesService],
  exports: [IndicesService],
})
export class IndicesModule {}
