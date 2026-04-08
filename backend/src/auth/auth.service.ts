import { Injectable, UnauthorizedException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokenResponse, AuthUserPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { hashPassword, verifyPassword } from './password.util';
import { sign, verify } from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto): Promise<AuthTokenResponse> {
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.displayName?.trim() || null;

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: hashPassword(dto.password),
          displayName,
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

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
