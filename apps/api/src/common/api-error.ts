import { HttpException } from '@nestjs/common';

/**
 * Errors the apps act on. The body is `{ error: <code>, ...extra }`; the code
 * picks the translated message on the screen, so no wording lives in the API.
 */
export class ApiError extends HttpException {
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super({ error: code, ...extra }, status);
  }
}

export const badRequest = (code: string, extra?: Record<string, unknown>) => new ApiError(400, code, extra);
export const unauthorized = (code = 'unauthorized', extra?: Record<string, unknown>) => new ApiError(401, code, extra);
export const forbidden = (code = 'forbidden') => new ApiError(403, code);
export const notFound = (code = 'not_found') => new ApiError(404, code);
export const conflict = (code: string, extra?: Record<string, unknown>) => new ApiError(409, code, extra);
export const locked = (lockedUntil: Date) => new ApiError(423, 'locked', { lockedUntil: lockedUntil.toISOString() });
