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

export class CreateExecutionDecisionDto {
  @IsString()
  @Matches(/^(BUY|SELL)$/)
  side!: 'BUY' | 'SELL';

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  symbol!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(600)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  plan?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  confidence!: number;

  @IsOptional()
  @IsDateString()
  tradeDate?: string;
}
