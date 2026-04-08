import { Controller, Get } from '@nestjs/common';
import { IndicesService } from './indices.service';

@Controller('indices')
export class IndicesController {
  constructor(private readonly indicesService: IndicesService) {}

  @Get()
  findAll() {
    return this.indicesService.getIndices();
  }
}
