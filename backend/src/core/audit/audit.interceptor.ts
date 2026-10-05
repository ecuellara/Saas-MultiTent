import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { tenantContext } from '../tenant-context/tenant-context.js';

/**
 * Auditoría append-only (doc §10).
 * Registra mutaciones críticas y, sobre todo, los intentos de acceso
 * cruzado (cuando la verificación de pertenencia falla → FAILURE).
 * Nunca rompe la petición: los fallos de escritura se ignoran.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      return next.handle();
    }
    const ruta: string = req.originalUrl ?? req.url ?? '';
    if (!this.esCritica(ruta)) return next.handle();

    const inicio = Date.now();
    return next.handle().pipe(
      tap({
        next: () => void this.registrar(req, 'SUCCESS', inicio).catch(() => undefined),
        error: (e) => void this.registrar(req, this.esCruce(e) ? 'FAILURE' : 'SUCCESS', inicio).catch(() => undefined),
      }),
    );
  }

  private esCritica(ruta: string): boolean {
    return /pacientes|odontograma|pagos|consentimientos|compras|insumos|usuarios|subscriptions|roles|memberships|sedes|platform|webhooks|facturacion|auth\/login/.test(
      ruta,
    );
  }

  private esCruce(e: unknown): boolean {
    return (
      e !== null &&
      typeof e === 'object' &&
      'status' in e &&
      ((e as { status: number }).status === 404 || (e as { status: number }).status === 403)
    );
  }

  private async registrar(req: Record<string, unknown>, resultado: string, inicio: number): Promise<void> {
    void inicio;
    const store = tenantContext.getStore();
    const headers = (req.headers ?? {}) as Record<string, string>;
    const db = this.prisma as unknown as {
      auditoria: { create: (a: unknown) => Promise<unknown> };
    };
    const url = String((req.originalUrl ?? req.url ?? '').toString()).slice(0, 200);
    await db.auditoria.create({
      data: {
        // `|| null`: el middleware crea el scope con '' antes del guard.
        tenantId: store?.tenantId || null,
        tabla: this.tablaDe(url),
        registroId: this.registroDe(url),
        accion: `${req.method} ${url}`,
        usuarioId: store?.userId || null,
        resultado,
        ip: (req.ip as string) ?? null,
        userAgent: headers['user-agent'] ?? null,
      },
    });
  }

  private tablaDe(url: string): string {
    const m = url.match(/\/api\/([a-z]+)/);
    return m ? m[1] : 'desconocida';
  }

  private registroDe(url: string): string {
    const partes = url.split('?')[0].split('/').filter(Boolean);
    const ultimo = partes[partes.length - 1] ?? '';
    return ultimo === 'api' ? '' : ultimo.slice(0, 120);
  }
}
