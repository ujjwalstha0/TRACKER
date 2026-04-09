import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUserPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateExecutionDecisionDto } from './dto/create-execution-decision.dto';
import { UpdateExecutionDecisionDto } from './dto/update-execution-decision.dto';
import { ExecutionDecisionsService } from './execution-decisions.service';

@Controller('execution-decisions')
@UseGuards(JwtAuthGuard)
export class ExecutionDecisionsController {
  constructor(private readonly executionDecisionsService: ExecutionDecisionsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUserPayload,
    @Query('tradeDate') tradeDate?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.executionDecisionsService.findAll(user.userId, tradeDate, parsedLimit);
  }

  @Post()
  create(@CurrentUser() user: AuthUserPayload, @Body() dto: CreateExecutionDecisionDto) {
    return this.executionDecisionsService.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExecutionDecisionDto,
  ) {
    return this.executionDecisionsService.update(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUserPayload, @Param('id', ParseIntPipe) id: number) {
    return this.executionDecisionsService.remove(user.userId, id);
  }
}
