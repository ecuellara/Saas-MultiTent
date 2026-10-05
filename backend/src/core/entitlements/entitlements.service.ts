import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Entitlements {
  planCodigo: string;
  subscriptionEstado: string;
  features: Record<string, { habilitado: boolean; limite: number | null }>;
}

/** Claves de límite con contador real definido (ver `contarUso`). */
export type ClaveLimite = 'max_sedes' | 'max_usuarios';

const CACHE_MS = 60_000;

/**
 * Tope de entradas de la caché de entitlements. El TTL solo descarta la entrada
 * cuando ese tenant se vuelve a consultar, así que sin tope un proceso de vida
 * larga con muchos tenants distintos crecería sin límite.
 */
const CACHE_MAX_ENTRADAS = 1_000;

/**
 * Tiempos de la transacción de creación. Son holgados a propósito: la
 * transacción pasa esperando el lock de fila del tenant y esa espera consume el
 * `timeout`. Con el valor por defecto (5 s) una cola de peticiones legítimas
 * acabaría en error de servidor en lugar de en un 403 honesto.
 */
const TX_TIMEOUT_MS = 20_000;
const TX_MAX_ESPERA_MS = 10_000;

/**
 * EntitlementsService (Fase 5, ADR-004 de planes).
 * Resuelve el plan vigente del tenant desde su `Subscription`.
 * Sin suscripción no restringe (periodo previo a facturación).
 * Nada de `if (plan === ...)` disperso: todo pasa por aquí.
 */
@Injectable()
export class EntitlementsService {
  private cache = new Map<string, { hasta: number; valor: Entitlements | null }>();
  /** Próxima purga de entradas expiradas (mismo criterio que `LimitadorIntentos`). */
  private proximaPurga = 0;

  constructor(private readonly prisma: PrismaService) {}

  async resolver(tenantId: string): Promise<Entitlements | null> {
    const ahora = Date.now();
    const hit = this.cache.get(tenantId);
    if (hit) {
      if (hit.hasta > ahora) return hit.valor;
      // Expirada: se descarta en el acto en lugar de esperar a la purga.
      this.cache.delete(tenantId);
    }

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
    this.guardar(tenantId, valor, ahora);
    return valor;
  }

  /** Exige suscripción vigente y feature habilitada. Sin suscripción, permite. */
  async requireFeature(tenantId: string, clave: string): Promise<void> {
    this.exigirFeatureDe(await this.resolver(tenantId), clave);
  }

  /**
   * Igual que `requireFeature` pero con los entitlements YA resueltos: es una
   * comprobación pura, **sin acceso a la base de datos**.
   *
   * Es la variante obligatoria dentro de una transacción: llamar a `resolver`
   * ahí pediría una SEGUNDA conexión del pool mientras la transacción retiene
   * la suya, lo que bajo carga puede agotar el pool y bloquearse a sí mismo.
   */
  exigirFeatureDe(ent: Entitlements | null, clave: string): void {
    if (!ent) return;
    if (!['TRIAL', 'ACTIVE'].includes(ent.subscriptionEstado)) {
      throw new ForbiddenException('Suscripción no vigente');
    }
    if (!ent.features[clave]?.habilitado) {
      throw new ForbiddenException(`Plan ${ent.planCodigo} sin acceso a ${clave}`);
    }
  }

  /**
   * Ejecuta la comprobación del límite Y la creación dentro de la MISMA
   * transacción, serializando por tenant con un lock de fila.
   *
   * Motivo (bug TOCTOU): contar fuera de la transacción y crear después dejaba
   * que N peticiones simultáneas leyeran el mismo uso y todas pasaran el límite.
   *
   * - `SELECT ... FOR UPDATE` sobre la fila del tenant al abrir la transacción:
   *   la segunda petición del mismo tenant espera a que la primera confirme y
   *   vuelve a contar **después** de su inserción.
   * - El uso se cuenta sobre el dato vivo (nada denormalizado que pueda
   *   desincronizarse).
   * - La creación se hace con el cliente de transacción (`tx`), nunca con
   *   `this.prisma`, para que forme parte de la misma unidad atómica.
   *
   * @param crear Callback de creación; recibe el `tx` y los entitlements ya
   * resueltos (para comprobar features sin volver a consultar la BD).
   */
  async crearConLimite<T, TCliente>(
    tenantId: string,
    clave: ClaveLimite,
    crear: (tx: TCliente, ent: Entitlements | null) => Promise<T>,
  ): Promise<T> {
    // Los entitlements se resuelven FUERA de la transacción a propósito:
    // resolverlos dentro consumiría una segunda conexión con el lock ya tomado
    // (mismo criterio que `ComprasService`), y con el pool lleno eso bloquearía
    // a la propia cola que espera el lock.
    const ent = await this.resolver(tenantId);
    const limite = ent?.features[clave]?.limite ?? null;

    return this.prisma.$transaction(
      async (tx) => {
        if (limite !== null) {
          // Lock de fila por tenant. Debe ejecutarse con `tx`: en otra conexión
          // el lock no serializaría nada. El template etiquetado envía
          // `tenantId` como parámetro `$1` (nunca interpolación de texto).
          await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
          const actual = await this.contarUso(tx, tenantId, clave);
          if (actual >= limite) {
            throw new ForbiddenException(`Límite del plan alcanzado (${clave}: ${limite})`);
          }
        }
        return crear(tx as unknown as TCliente, ent);
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_ESPERA_MS },
    );
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /**
   * Uso real del tenant para una clave de límite: se cuenta sobre el dato vivo,
   * no sobre contadores denormalizados. `tenantId` va explícito para que la
   * intención sea legible y no dependa de la extensión de aislamiento.
   */
  private async contarUso(tx: unknown, tenantId: string, clave: string): Promise<number> {
    const t = tx as {
      sede: { count: (a: unknown) => Promise<number> };
      membership: { count: (a: unknown) => Promise<number> };
    };
    switch (clave) {
      case 'max_sedes':
        return t.sede.count({ where: { tenantId, deletedAt: null } });
      case 'max_usuarios':
        return t.membership.count({ where: { tenantId, estado: 'ACTIVE' } });
      default:
        throw new InternalServerErrorException(`Sin contador definido para el límite ${clave}`);
    }
  }

  /** Inserta en la caché respetando el tope de tamaño. */
  private guardar(tenantId: string, valor: Entitlements | null, ahora: number): void {
    this.purgar(ahora);
    this.cache.set(tenantId, { hasta: ahora + CACHE_MS, valor });
    // Tope duro: si aun así se supera, se evicta lo más antiguo (el `Map`
    // conserva el orden de inserción) para que el proceso no crezca sin límite.
    while (this.cache.size > CACHE_MAX_ENTRADAS) {
      const masAntigua = this.cache.keys().next().value;
      if (masAntigua === undefined) break;
      this.cache.delete(masAntigua);
    }
  }

  /** Descarta entradas expiradas (periódicamente o si la caché llega al tope). */
  private purgar(ahora: number): void {
    if (ahora < this.proximaPurga && this.cache.size <= CACHE_MAX_ENTRADAS) return;
    this.proximaPurga = ahora + CACHE_MS;
    for (const [clave, entrada] of this.cache) {
      if (entrada.hasta <= ahora) this.cache.delete(clave);
    }
  }
}
