import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyRegisterOtpDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit code.' })
  otp!: string;
}
