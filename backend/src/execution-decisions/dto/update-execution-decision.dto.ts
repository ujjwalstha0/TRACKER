import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateExecutionDecisionDto {
  @IsOptional()
  @IsString()
  @Matches(/^(BUY|SELL)$/)
  side?: 'BUY' | 'SELL';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(600)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  plan?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  confidence?: number;

  @IsOptional()
  @IsString()
  @Matches(/^(PENDING|CORRECT|PARTIAL|WRONG|SKIPPED)$/)
  outcome?: 'PENDING' | 'CORRECT' | 'PARTIAL' | 'WRONG' | 'SKIPPED';

  @IsOptional()
  @IsString()
  @MaxLength(800)
  reviewNote?: string;

  @IsOptional()
  @IsDateString()
  tradeDate?: string;
}
