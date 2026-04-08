import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateHoldingDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  buyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  qty?: number;

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
