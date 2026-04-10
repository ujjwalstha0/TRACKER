import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateIpoAlertStatusDto {
  @IsString()
  @MinLength(6)
  @MaxLength(600)
  ipoAlertId!: string;
}