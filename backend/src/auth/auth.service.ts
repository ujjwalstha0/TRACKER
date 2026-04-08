import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { sign, verify } from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokenResponse, AuthUserPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyRegisterOtpDto } from './dto/verify-register-otp.dto';
import { hashPassword, verifyPassword } from './password.util';

type OtpPurpose = 'REGISTER' | 'PASSWORD_RESET';

interface RegisterOtpPayload {
  passwordHash: string;
  displayName: string | null;
}

const OTP_LENGTH = 6;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private mailer: ReturnType<typeof nodemailer.createTransport> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async requestRegistrationOtp(dto: RegisterDto): Promise<{ message: string }> {
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.displayName?.trim() || null;

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const code = this.generateOtpCode();

    await this.storeOtp(email, 'REGISTER', code, {
      passwordHash: hashPassword(dto.password),
      displayName,
    });

    await this.sendOtpEmail(email, code, 'REGISTER');

    return {
      message: 'Verification code sent to your email.',
    };
  }

  async verifyRegistrationOtp(dto: VerifyRegisterOtpDto): Promise<AuthTokenResponse> {
    const email = dto.email.trim().toLowerCase();
    const otpEntry = await this.verifyAndConsumeOtp(email, 'REGISTER', dto.otp);
    const payload = this.readRegisterPayload(otpEntry.payload);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: payload.passwordHash,
          displayName: payload.displayName,
        },
      });

      return this.toTokenResponse({
        id: Number(user.id),
        email: user.email,
        displayName: user.displayName,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Email is already registered.');
      }

      throw new InternalServerErrorException('Unable to create account right now.');
    }
  }

  async requestPasswordResetOtp(dto: RequestPasswordResetDto): Promise<{ message: string }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      return {
        message: 'If this email is registered, an OTP has been sent.',
      };
    }

    const code = this.generateOtpCode();
    await this.storeOtp(email, 'PASSWORD_RESET', code, undefined);
    await this.sendOtpEmail(email, code, 'PASSWORD_RESET');

    return {
      message: 'If this email is registered, an OTP has been sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired OTP.');
    }

    await this.verifyAndConsumeOtp(email, 'PASSWORD_RESET', dto.otp);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(dto.newPassword),
      },
    });

    return {
      message: 'Password reset successful. You can login now.',
    };
  }

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.toTokenResponse({
      id: Number(user.id),
      email: user.email,
      displayName: user.displayName,
    });
  }

  async me(userId: number): Promise<AuthTokenResponse['user']> {
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return {
      id: Number(user.id),
      email: user.email,
      displayName: user.displayName,
    };
  }

  verifyToken(token: string): AuthUserPayload {
    try {
      const decoded = verify(token, this.jwtSecret());
      if (typeof decoded === 'string' || !decoded) {
        throw new UnauthorizedException('Invalid token payload.');
      }

      const payload = decoded as { sub?: unknown; email?: unknown };
      if (typeof payload.sub !== 'number' || typeof payload.email !== 'string') {
        throw new UnauthorizedException('Invalid token payload.');
      }

      return {
        userId: payload.sub,
        email: payload.email,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }

  private toTokenResponse(user: AuthTokenResponse['user']): AuthTokenResponse {
    const token = sign(
      {
        sub: user.id,
        email: user.email,
      },
      this.jwtSecret(),
      {
        expiresIn: '7d',
      },
    );

    return {
      token,
      user,
    };
  }

  private jwtSecret(): string {
    return process.env.JWT_SECRET ?? 'dev-secret-change-me';
  }

  private otpExpiryMinutes(): number {
    const parsed = Number(process.env.OTP_EXPIRY_MINUTES ?? '10');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 10;
    }

    return Math.max(1, Math.floor(parsed));
  }

  private otpFromAddress(): string {
    const configured = process.env.SMTP_FROM?.trim();
    return configured && configured.length > 0 ? configured : 'ujjwal@arthahub.space';
  }

  private generateOtpCode(): string {
    return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  }

  private hashOtp(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private getMailer() {
    if (this.mailer) {
      return this.mailer;
    }

    const host = process.env.SMTP_HOST;
    const username = process.env.SMTP_USER;
    const password = process.env.SMTP_PASS;
    const parsedPort = Number(process.env.SMTP_PORT ?? '587');

    if (!host || !username || !password || !Number.isFinite(parsedPort)) {
      throw new InternalServerErrorException('Email service is not configured.');
    }

    const secure = process.env.SMTP_SECURE === 'true' || parsedPort === 465;

    this.mailer = nodemailer.createTransport({
      host,
      port: parsedPort,
      secure,
      auth: {
        user: username,
        pass: password,
      },
    });

    return this.mailer;
  }

  private async sendOtpEmail(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    const expiryMinutes = this.otpExpiryMinutes();
    const subject =
      purpose === 'REGISTER'
        ? 'ArthaHub account verification code'
        : 'ArthaHub password reset code';
    const actionText =
      purpose === 'REGISTER' ? 'verify your new account' : 'reset your password';

    const text = [
      `Your OTP to ${actionText} is ${code}.`,
      `This code expires in ${expiryMinutes} minutes.`,
      'If you did not request this code, you can ignore this email.',
    ].join('\n');

    try {
      await this.getMailer().sendMail({
        from: this.otpFromAddress(),
        to: email,
        subject,
        text,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">\
<p>Your OTP to <strong>${actionText}</strong> is:</p>\
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">${code}</p>\
<p>This code expires in ${expiryMinutes} minutes.</p>\
<p>If you did not request this code, you can ignore this email.</p>\
</div>`,
      });
    } catch {
      throw new InternalServerErrorException('Failed to send OTP email. Please try again.');
    }
  }

  private async storeOtp(
    email: string,
    purpose: OtpPurpose,
    code: string,
    payload: Prisma.InputJsonValue | undefined,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.otpExpiryMinutes() * 60_000);

    await this.prisma.authOtp.updateMany({
      where: {
        email,
        purpose,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    await this.prisma.authOtp.create({
      data: {
        email,
        purpose,
        codeHash: this.hashOtp(code),
        payload,
        expiresAt,
      },
    });
  }

  private async verifyAndConsumeOtp(email: string, purpose: OtpPurpose, otp: string) {
    const now = new Date();

    const current = await this.prisma.authOtp.findFirst({
      where: {
        email,
        purpose,
        usedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!current) {
      throw new UnauthorizedException('Invalid or expired OTP.');
    }

    if (current.codeHash !== this.hashOtp(otp)) {
      const attempts = current.attempts + 1;
      await this.prisma.authOtp.update({
        where: {
          id: current.id,
        },
        data: {
          attempts,
          usedAt: attempts >= OTP_MAX_ATTEMPTS ? new Date() : undefined,
        },
      });

      throw new UnauthorizedException('Invalid or expired OTP.');
    }

    await this.prisma.authOtp.update({
      where: {
        id: current.id,
      },
      data: {
        usedAt: new Date(),
      },
    });

    return current;
  }

  private readRegisterPayload(payload: unknown): RegisterOtpPayload {
    if (!payload || typeof payload !== 'object') {
      throw new UnauthorizedException('Invalid or expired OTP.');
    }

    const raw = payload as { passwordHash?: unknown; displayName?: unknown };
    if (typeof raw.passwordHash !== 'string' || !raw.passwordHash) {
      throw new UnauthorizedException('Invalid or expired OTP.');
    }

    const displayName =
      typeof raw.displayName === 'string'
        ? raw.displayName
        : raw.displayName === null || raw.displayName === undefined
          ? null
          : null;

    return {
      passwordHash: raw.passwordHash,
      displayName,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
