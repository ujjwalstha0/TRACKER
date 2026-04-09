import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ExecutionDecisionsController } from './execution-decisions.controller';
import { ExecutionDecisionsService } from './execution-decisions.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ExecutionDecisionsController],
  providers: [ExecutionDecisionsService],
  exports: [ExecutionDecisionsService],
})
export class ExecutionDecisionsModule {}
