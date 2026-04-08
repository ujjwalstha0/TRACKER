import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUserPayload } from './auth.types';
import { AuthenticatedRequest } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserPayload => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user as AuthUserPayload;
  },
);
