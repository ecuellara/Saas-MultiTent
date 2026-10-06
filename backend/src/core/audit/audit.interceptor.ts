import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { tenantContext } from '../tenant-context/tenant-context.js';

/** Resultados admitidos por `Auditoria.resultado` (doc §10). */
export type ResultadoAuditoria = 'SUCCESS' | 'FAILURE';

/** Marca explícita de "intento de acceso cruzado entre tenants". */
export const MARCA_ACCESO_CRUZADO = 'acceso_cruzado';

/**
 * Error de acceso cruzado entre tenants (doc §10).
 *
 * Es un `NotFoundException`, así que **la respuesta HTTP no cambia** (sigue
 * siendo 404, sin revelar la existencia del recurso ajeno). Lo que cambia es
 * que el interceptor de auditoría puede reconocerlo como una señal explícita
 * en lugar de adivinarla a partir del código HTTP: un 404 legítimo (recurso
 * inexistente) o un 403 de permisos NO son accesos cruzados y no deben
 * diluir esa señal.
 *
 * Uso desde un servicio (basta con sustituir el `throw` actual):
 * ```ts
 * throw new CrossTenantError('paciente');
 * ```
 *
 * Si el servicio no puede importar este error, el helper `marcarAccesoCruzado`
 * marca cualquier error ya construido sin alterar su status.
 */
export class CrossTenantError extends NotFoundException {
  readonly accesoCruzado = true;
  readonly recurso: string;

  constructor(recurso = 'recurso') {
    super(`${recurso} no encontrado`);
    this.name = 'CrossTenantError';
    this.recurso = recurso;
  }
}

/**
 * Marca `error` como intento de acceso cruzado sin cambiar su respuesta HTTP
 * (devuelve la misma instancia). Pensado para los servicios que ya lanzan un
 * `NotFoundException` y no quieren acoplarse a `CrossTenantError`.
 */
export function marcarAccesoCruzado<T extends object>(error: T): T {
  Object.defineProperty(error, MARCA_ACCESO_CRUZADO, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return error;
}

/**
 * Campos que NUNCA deben quedar en `Auditoria.datosNuevos`: credenciales,
 * tokens, secretos MFA, claves de almacenamiento y material de firma.
 */
const CLAVES_SENSIBLES_EXACTAS = new Set([
  'password',
  'passwordHash',
  'passwordAlgo',
  'clave',
  'actual',
  'nueva',
  'mfaSecret',
  'temp_token',
  'refreshToken',
  'refresh_token',
  'access_token',
  'storageKey',
  'datosSnapshot',
  'cuerpoSnapshot',
]);

/** Trozos que, si aparecen en el nombre de un campo, implican redacción. */
const SUBCADENAS_SENSIBLES = [
  'password',
  'contraseña',
  'contrasena',
  'secret',
  'token',
  'firma',
  'signature',
  'apikey',
  'api_key',
  'privatekey',
] as const;

/** Valor sustituto de todo campo redactado. */
const REDACTADO = '[REDACTADO]';

/** Las cadenas más largas se truncan (evita volcar bases64 de firmas). */
const MAX_LARGO_CADENA = 500;

/** Profundidad máxima al serializar el cuerpo (evita ciclos/anidamiento hostil). */
const MAX_PROFUNDIDAD = 8;

/**
 * Correspondencia ÚNICA recurso de la URL → modelo Prisma de los recursos
 * auditables: de aquí salen tanto `Auditoria.tabla` (el recurso de la URL) como
 * el delegado con el que se lee la IMAGEN PREVIA. No duplicar esta tabla en
 * otro sitio.
 *
 * Solo entran modelos con `tenantId` denormalizado (ADR-002): sin tenant en la
 * fila no habría pertenencia que verificar y la imagen previa no podría
 * descartarse con criterio. Por eso NO entra `usuarios` (`User` es global y su
 * vínculo con el tenant vive en `Membership`) ni `webhooks` (`WebhookEvent` no
 * tiene `tenantId`).
 */
const MODELO_POR_RECURSO: Record<string, string> = {
  pacientes: 'paciente',
  citas: 'cita',
  historiales: 'historialClinico',
  odontogramas: 'odontograma',
  consentimientos: 'consentimientoFirmado',
  pagos: 'pago',
  compras: 'compra',
  insumos: 'insumo',
  proveedores: 'proveedor',
  especialidades: 'especialidad',
  tratamientos: 'tratamiento',
  subscriptions: 'subscription',
  roles: 'role',
  memberships: 'membership',
  sedes: 'sede',
  facturacion: 'cobroSuscripcion',
};

/** Forma mínima del cliente Prisma que usa el interceptor. */
interface ClienteAuditoria {
  auditoria: { create: (a: unknown) => Promise<unknown> };
  platformAuditLog: { create: (a: unknown) => Promise<unknown> };
}

/** Delegado Prisma mínimo para leer la fila actual (imagen previa por `id`). */
interface DelegadoLectura {
  findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
}

/** Payload de la fila de `Auditoria` (equivale a `Prisma.AuditoriaUncheckedCreateInput`). */
interface FilaAuditoria {
  // `null` cuando el TenantContext no está validado: nunca se atribuye una
  // acción anónima a un tenant que no existe.
  tenantId: string | null;
  tabla: string;
  registroId: string;
  accion: string;
  usuarioId: string | null;
  resultado: ResultadoAuditoria;
  ip: string | null;
  userAgent: string | null;
  /** IMAGEN PREVIA del registro (estado ANTERIOR); `null` si no se pudo leer. */
  datosAnteriores: Record<string, unknown> | null;
  datosNuevos: Record<string, unknown> | null;
}

/** Payload de la fila de `PlatformAuditLog`. */
interface FilaPlatformAudit {
  platformUserId: string;
  accion: string;
  recurso: string;
  recursoId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown>;
}

type JsonRedactado =
  | string
  | number
  | boolean
  | null
  | JsonRedactado[]
  | { [clave: string]: JsonRedactado };

/**
 * Auditoría append-only (doc §10).
 * Registra mutaciones críticas y, sobre todo, los intentos de acceso
 * cruzado (marcados EXPLÍCITAMENTE con `CrossTenantError`).
 * Nunca rompe la petición: los fallos de escritura se ignoran.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      return next.handle();
    }
    const ruta: string = req.originalUrl ?? req.url ?? '';
    if (!this.esCritica(ruta)) return next.handle();

    // Instantánea redactada del cuerpo ANTES de ejecutar el handler. El
    // interceptor corre después de los pipes, así que `req.body` ya está
    // validado/normalizado.
    const datosNuevos = this.snapshotRedactado(req.body);
    // IMAGEN PREVIA: estado de la fila ANTES del handler. Se lee aquí —y no en
    // cada servicio— y se espera antes de `next.handle()`, que es justo lo que
    // permite rellenar `datosAnteriores` sin tocar ningún servicio. Nunca
    // lanza: si la lectura falla, se sigue con `null`.
    const datosAnteriores = await this.imagenPreviaDe(req);
    return next.handle().pipe(
      tap({
        // Un handler que termina sin lanzar es un éxito, sin excepciones.
        next: () =>
          void this.registrar(req, 'SUCCESS', datosNuevos, datosAnteriores).catch(() => undefined),
        // Cualquier error es FAILURE: antes se registraba como SUCCESS salvo
        // 404/403, de modo que un 401 por fuerza bruta o un 500 quedaban como
        // éxito. El acceso cruzado se distingue por la marca del error, no por
        // el código HTTP. La imagen previa se guarda TAMBIÉN en el error: el
        // estado anterior es más útil, si cabe, cuando algo falla.
        error: (e: unknown) =>
          void this.registrar(
            req,
            'FAILURE',
            datosNuevos,
            datosAnteriores,
            this.motivoDe(e),
            this.esAccesoCruzado(e) ? this.mensajeDe(e) : undefined,
          ).catch(() => undefined),
      }),
    );
  }

  private esCritica(ruta: string): boolean {
    return /pacientes|odontograma|pagos|consentimientos|compras|insumos|usuarios|subscriptions|roles|memberships|sedes|platform|webhooks|facturacion|auth\/login/.test(
      ruta,
    );
  }

  /**
   * Detecta el acceso cruzado por MARCA EXPLÍCITA en el error. No se usa el
   * status HTTP: un 404 legítimo (recurso inexistente) y un 403 de permisos no
   * son accesos cruzados y contaminarían la señal.
   */
  private esAccesoCruzado(e: unknown): boolean {
    if (e === null || typeof e !== 'object') return false;
    if (e instanceof CrossTenantError) return true;
    return (e as Record<string, unknown>)[MARCA_ACCESO_CRUZADO] === true;
  }

  /**
   * Solo los accesos cruzados llevan marca persistida. Para el resto de fallos
   * no se guarda nada: el mensaje de un 400 puede contener datos del usuario y
   * no hay columna donde dejarlo sin escribirlo en `datosNuevos`.
   */
  private motivoDe(e: unknown): string | undefined {
    return this.esAccesoCruzado(e) ? MARCA_ACCESO_CRUZADO : undefined;
  }

  /** Mensaje del error, acotado: solo para diagnóstico interno de la auditoría. */
  private mensajeDe(e: unknown): string {
    if (e instanceof Error && typeof e.message === 'string') return e.message.slice(0, 300);
    return 'Error sin mensaje';
  }

  private async registrar(
    req: Record<string, unknown>,
    resultado: ResultadoAuditoria,
    datosNuevos: Record<string, unknown> | null,
    datosAnteriores: Record<string, unknown> | null,
    motivo?: string,
    detalle?: string,
  ): Promise<void> {
    const store = tenantContext.getStore();
    const headers = this.headersDe(req);
    const db = this.prisma as unknown as ClienteAuditoria;
    const url = String((req.originalUrl ?? req.url ?? '').toString()).slice(0, 200);
    const tabla = this.recursoDe(url);
    const registroId = this.registroDe(url);

    // Rutas de plataforma → PlatformAuditLog (sin tenant); resto → Auditoria.
    const platformUser = req.platformUser as { id: string } | undefined;
    if (platformUser) {
      const filaPlatform: FilaPlatformAudit = {
        platformUserId: platformUser.id,
        accion: `${String(req.method)} ${url}`,
        recurso: tabla,
        recursoId: registroId || null,
        ip: (req.ip as string) ?? null,
        userAgent: headers['user-agent'] ?? null,
        metadata: { resultado, ...(motivo ? { motivo } : {}) },
      };
      await db.platformAuditLog.create({ data: filaPlatform });
      return;
    }

    const fila: FilaAuditoria = {
      // Solo se atribuye a un tenant cuando TenantGuard lo validó; en rutas
      // @Public/@Platform (o si el guard no corrió) queda `null`, nunca ''.
      tenantId: this.tenantValidado(store),
      tabla,
      registroId,
      accion: `${String(req.method)} ${url}`,
      usuarioId: store?.validado ? store.userId || null : null,
      resultado,
      ip: (req.ip as string) ?? null,
      userAgent: headers['user-agent'] ?? null,
      // Imagen previa capturada por el propio interceptor ANTES del handler
      // (`imagenPreviaDe`): describe el estado anterior y se guarda tanto en
      // éxito como en error. Es `null` si no había recurso identificable, si el
      // registro no existe, si la lectura falló o si la fila NO pertenece al
      // tenant validado (nunca se filtra a la auditoría un dato de otro tenant).
      datosAnteriores,
      datosNuevos: this.datosConMotivo(resultado, datosNuevos, motivo, detalle),
    };
    await db.auditoria.create({ data: fila });
  }

  /**
   * `Auditoria` no tiene columna propia para el motivo, así que la marca de
   * acceso cruzado viaja dentro de `datosNuevos` (que es la única columna Json
   * disponible para diagnóstico). En un error no hay cuerpo que preservar como
   * "datos nuevos", de modo que el objeto solo lleva la marca.
   */
  private datosConMotivo(
    resultado: ResultadoAuditoria,
    datosNuevos: Record<string, unknown> | null,
    motivo?: string,
    detalle?: string,
  ): Record<string, unknown> | null {
    if (resultado !== 'SUCCESS') {
      return motivo ? { _auditoria: { motivo, ...(detalle ? { detalle } : {}) } } : null;
    }
    return datosNuevos;
  }

  /** Tenant del contexto SOLO si el guard lo validó; si no, `null`. */
  private tenantValidado(store: { tenantId: string; validado: boolean } | undefined): string | null {
    if (!store?.validado) return null;
    const id = (store.tenantId ?? '').trim();
    return id === '' ? null : id;
  }

  private headersDe(req: Record<string, unknown>): Record<string, string> {
    const h = (req.headers ?? {}) as Record<string, unknown>;
    const salida: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      if (typeof v === 'string') salida[k.toLowerCase()] = v;
    }
    return salida;
  }

  /**
   * Instantánea redactada y truncada del cuerpo de la petición.
   * Redacta credenciales/tokens/firmas y NO debe registrar datos clínicos en
   * claro: el llamador decide qué rutas son críticas; aquí solo se copia la
   * entrada con las claves sensibles sustituidas.
   */
  private snapshotRedactado(body: unknown): Record<string, unknown> | null {
    if (body === null || body === undefined) return null;
    if (typeof body !== 'object' || Array.isArray(body)) return null;
    const redactado = this.redactar(body, 0);
    if (redactado === null || typeof redactado !== 'object' || Array.isArray(redactado)) return null;
    return redactado as Record<string, unknown>;
  }

  private redactar(valor: unknown, profundidad: number): JsonRedactado {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'string') return this.truncar(valor);
    if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
    if (typeof valor === 'bigint') return valor.toString();
    if (valor instanceof Date) return valor.toISOString();
    // Prisma entrega las columnas `Decimal` como objetos Decimal.js: sin esta
    // rama, la imagen previa volcaría su representación interna (`s`/`e`/`d`)
    // en lugar del importe. Se resuelve con la MISMA política de redacción.
    if (typeof (valor as { toFixed?: unknown }).toFixed === 'function') {
      return this.truncar(String(valor));
    }
    if (Array.isArray(valor)) {
      if (profundidad >= MAX_PROFUNDIDAD) return '[PROFUNDIDAD_MAXIMA]';
      return valor.slice(0, 100).map((v) => this.redactar(v, profundidad + 1));
    }
    if (typeof valor === 'object') {
      if (profundidad >= MAX_PROFUNDIDAD) return '[PROFUNDIDAD_MAXIMA]';
      const salida: { [clave: string]: JsonRedactado } = {};
      for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
        salida[clave] = this.esSensible(clave) ? REDACTADO : this.redactar(v, profundidad + 1);
      }
      return salida;
    }
    // function | symbol
    return '[NO_SERIALIZABLE]';
  }

  private esSensible(clave: string): boolean {
    if (CLAVES_SENSIBLES_EXACTAS.has(clave)) return true;
    const minuscula = clave.toLowerCase();
    return SUBCADENAS_SENSIBLES.some((s) => minuscula.includes(s));
  }

  private truncar(texto: string): string {
    return texto.length > MAX_LARGO_CADENA
      ? `${texto.slice(0, MAX_LARGO_CADENA)}…[TRUNCADO ${texto.length - MAX_LARGO_CADENA} chars]`
      : texto;
  }

  /**
   * `true` si la petición puede tener una fila ANTERIOR que leer: `PATCH`,
   * `PUT` y `DELETE` siempre; `POST` solo cuando la ruta declara `:id` (p. ej.
   * `POST /pacientes/:id/documentos`). Un `POST` de creación no tiene estado
   * anterior que capturar.
   */
  private esMutacionConRecurso(req: Record<string, unknown>): boolean {
    const metodo = String(req.method ?? '').toUpperCase();
    if (metodo === 'PATCH' || metodo === 'PUT' || metodo === 'DELETE') return true;
    if (metodo !== 'POST') return false;
    const ruta = (req.route as { path?: unknown } | undefined)?.path;
    if (typeof ruta === 'string' && ruta.includes(':id')) return true;
    // Respaldo: `req.params` solo trae `id` si la ruta lo declara.
    return this.idDe(req) !== null;
  }

  /** `id` de la ruta (`req.params.id`), o `null` si no hay. */
  private idDe(req: Record<string, unknown>): string | null {
    const params = req.params as Record<string, unknown> | undefined;
    const id = params?.id;
    return typeof id === 'string' && id.trim() !== '' ? id : null;
  }

  /**
   * `Auditoria.tabla`: el recurso de la ruta (`/api/<recurso>/...`), que es la
   * MISMA clave con la que `MODELO_POR_RECURSO` localiza el modelo Prisma. Un
   * solo sitio para la correspondencia, sin tablas paralelas.
   */
  private recursoDe(url: string): string {
    const m = url.match(/\/api\/([a-z]+)/);
    return m ? m[1] : 'desconocida';
  }

  /** Modelo Prisma del recurso (`MODELO_POR_RECURSO`), o `null` si no aplica. */
  private modeloDe(url: string): string | null {
    return MODELO_POR_RECURSO[this.recursoDe(url)] ?? null;
  }

  /**
   * IMAGEN PREVIA: estado de la fila que el handler va a mutar, leído ANTES de
   * que se ejecute. Es la fuente de `Auditoria.datosAnteriores` y evita tocar
   * cada servicio.
   *
   * Se pasa por la MISMA `redactar` que `datosNuevos`: una sola política de
   * redacción (secretos → `[REDACTADO]`, cadenas truncadas, profundidad
   * acotada).
   *
   * Devuelve `null` —sin lanzar nunca, la auditoría no puede tumbar la
   * petición— cuando:
   *  - la petición no es una mutación con recurso identificable;
   *  - el recurso no está en `MODELO_POR_RECURSO` o no hay `id` en la ruta;
   *  - no hay tenant VALIDADO en el contexto (no se podría comprobar nada);
   *  - el registro no existe o la lectura falla;
   *  - la fila pertenece a OTRO tenant: `findUnique` por id NO pasa por la
   *    extensión de aislamiento, así que la pertenencia se verifica aquí y, si
   *    no coincide, no se persiste ni un dato ajeno.
   */
  private async imagenPreviaDe(
    req: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!this.esMutacionConRecurso(req)) return null;
    const url = String((req.originalUrl ?? req.url ?? '').toString());
    const modelo = this.modeloDe(url);
    if (!modelo) return null;
    const id = this.idDe(req);
    if (!id) return null;
    // Tenant del contexto SOLO si el guard lo validó: una ruta @Public no lee
    // imágenes previas (no hay sesión a la que atribuir la fila).
    const tenantEsperado = this.tenantValidado(tenantContext.getStore());
    if (!tenantEsperado) return null;
    try {
      const db = this.prisma as unknown as Record<string, DelegadoLectura | undefined>;
      const delegado = db[modelo];
      if (!delegado) return null;
      const fila = await delegado.findUnique({ where: { id } });
      if (!fila || fila.tenantId !== tenantEsperado) return null;
      const redactada = this.redactar(fila, 0);
      if (redactada === null || typeof redactada !== 'object' || Array.isArray(redactada)) {
        return null;
      }
      return redactada as Record<string, unknown>;
    } catch {
      // Registro inexistente, error de BD, modelo no expuesto: sin imagen
      // previa y la petición sigue su curso.
      return null;
    }
  }

  private registroDe(url: string): string {
    const partes = url.split('?')[0].split('/').filter(Boolean);
    const ultimo = partes[partes.length - 1] ?? '';
    return ultimo === 'api' ? '' : ultimo.slice(0, 120);
  }
}
