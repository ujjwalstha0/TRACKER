import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateHoldingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  symbol!: string;

  @IsNumber()
  @Min(0.01)
  buyPrice!: number;

  @IsNumber()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  targetPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  stopLoss?: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}
