import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Entitlements {
  planCodigo: string;
  subscriptionEstado: string;
  features: Record<string, { habilitado: boolean; limite: number | null }>;
}

const CACHE_MS = 60_000;

/**
 * EntitlementsService (Fase 5, ADR-004 de planes).
 * Resuelve el plan vigente del tenant desde su `Subscription`.
 * Sin suscripción no restringe (periodo previo a facturación).
 * Nada de `if (plan === ...)` disperso: todo pasa por aquí.
 */
@Injectable()
export class EntitlementsService {
  private cache = new Map<string, { hasta: number; valor: Entitlements | null }>();

  constructor(private readonly prisma: PrismaService) {}

  async resolver(tenantId: string): Promise<Entitlements | null> {
    const ahora = Date.now();
    const hit = this.cache.get(tenantId);
    if (hit && hit.hasta > ahora) return hit.valor;

    const db = this.prisma as unknown as {
      subscription: {
        findUnique: (a: unknown) => Promise<{
          estado: string;
          plan: {
            codigo: string;
            features: Array<{ clave: string; habilitado: boolean; limite: number | null }>;
          };
        } | null>;
      };
    };
    const sub = await db.subscription.findUnique({
      where: { tenantId },
      include: { plan: { include: { features: true } } },
    });
    const valor: Entitlements | null = sub
      ? {
          planCodigo: sub.plan.codigo,
          subscriptionEstado: sub.estado,
          features: Object.fromEntries(
            sub.plan.features.map((f) => [f.clave, { habilitado: f.habilitado, limite: f.limite }]),
          ),
        }
      : null;
    this.cache.set(tenantId, { hasta: ahora + CACHE_MS, valor });
    return valor;
  }

  /** Exige suscripción vigente y feature habilitada. Sin suscripción, permite. */
  async requireFeature(tenantId: string, clave: string): Promise<void> {
    const ent = await this.resolver(tenantId);
    if (!ent) return;
    if (!['TRIAL', 'ACTIVE'].includes(ent.subscriptionEstado)) {
      throw new ForbiddenException('Suscripción no vigente');
    }
    if (!ent.features[clave]?.habilitado) {
      throw new ForbiddenException(`Plan ${ent.planCodigo} sin acceso a ${clave}`);
    }
  }

  /** Exige no superar el límite del plan. Sin suscripción o sin límite, permite. */
  async checkLimit(tenantId: string, clave: string, actual: number): Promise<void> {
    const ent = await this.resolver(tenantId);
    if (!ent) return;
    const limite = ent.features[clave]?.limite;
    if (limite !== null && limite !== undefined && actual >= limite) {
      throw new ForbiddenException(`Límite del plan alcanzado (${clave}: ${limite})`);
    }
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
