import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Observable, tap } from 'rxjs';
import { tenantContext } from '../tenant-context/tenant-context.js';

/**
 * Logs estructurados JSON (doc §11): timestamp, level, requestId, tenantId,
 * userId, route, latency, status. El requestId viaja en `x-request-id`.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest() as {
      method: string;
      originalUrl?: string;
      url?: string;
      headers: Record<string, string | undefined>;
      requestId?: string;
    };
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    const inicio = Date.now();
    const requestId =
      req.headers['x-request-id'] ?? req.requestId ?? crypto.randomUUID().slice(0, 8);
    req.requestId = requestId;
    return next.handle().pipe(
      tap({
        next: () => this.emit(req, res.statusCode, inicio, requestId, 'info'),
        error: (e: unknown) => {
          const status =
            e !== null && typeof e === 'object' && 'status' in e
              ? (e as { status: number }).status
              : 500;
          this.emit(req, status, inicio, requestId, status >= 500 ? 'error' : 'warn');
        },
      }),
    );
  }

  private emit(
    req: { method: string; originalUrl?: string; url?: string },
    status: number,
    inicio: number,
    requestId: string,
    level: string,
  ): void {
    const ctx = tenantContext.getStore();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        requestId,
        tenantId: ctx?.tenantId ?? null,
        userId: ctx?.userId ?? null,
        route: `${req.method} ${(req.originalUrl ?? req.url ?? '').split('?')[0]}`,
        latency: Date.now() - inicio,
        status,
      }),
    );
  }
}
