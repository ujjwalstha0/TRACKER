import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthUserPayload } from './auth.types';

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthUserPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    request.user = this.authService.verifyToken(token);
    return true;
  }
}
