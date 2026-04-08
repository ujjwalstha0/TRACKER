import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthUserPayload } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyRegisterOtpDto } from './dto/verify-register-otp.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface RequestWithIp {
  ip?: string;
  headers: {
    'x-forwarded-for'?: string | string[];
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private resolveClientIp(request: RequestWithIp): string | undefined {
    const forwardedFor = request.headers['x-forwarded-for'];
    const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const firstForwarded = forwarded?.split(',')[0]?.trim();
    return firstForwarded || request.ip;
  }

  @Post('register/request-otp')
  requestRegisterOtp(@Body() dto: RegisterDto, @Req() request: RequestWithIp) {
    return this.authService.requestRegistrationOtp(dto, this.resolveClientIp(request));
  }

  @Post('register/verify-otp')
  verifyRegisterOtp(@Body() dto: VerifyRegisterOtpDto) {
    return this.authService.verifyRegistrationOtp(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('password/forgot/request-otp')
  requestForgotPasswordOtp(@Body() dto: RequestPasswordResetDto, @Req() request: RequestWithIp) {
    return this.authService.requestPasswordResetOtp(dto, this.resolveClientIp(request));
  }

  @Post('password/forgot/reset')
  resetForgotPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: AuthUserPayload, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUserPayload) {
    return this.authService.me(user.userId);
  }
}
