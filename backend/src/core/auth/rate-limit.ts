import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Limitador de intentos en memoria (etapa 1, doc §8.2).
 *
 * - Contadores **independientes** por cada clave: una regla por IP y otra por
 *   identificador (email de login o usuario del paso MFA). Así el *password
 *   spraying* a 10.000 emails desde una sola IP choca con la regla de IP y el
 *   ataque a una cuenta concreta choca con la regla de email.
 * - Ventana temporal deslizante y **purga de entradas expiradas**: el `Map` no
 *   crece sin límite.
 * - Al superar el límite lanza `HttpException` 429.
 *
 * ETAPA 2: sustituir por Redis. El estado en memoria **no se comparte entre
 * instancias** (la API es stateless, ADR-010), de modo que con varias réplicas
 * el límite efectivo se multiplica por el número de instancias.
 */

export interface ReglaIntento {
  /** Clave del contador (construir con `claveIp` / `claveIdentificador`). */
  clave: string;
  /** Intentos permitidos dentro de la ventana. */
  limite: number;
  /** Tamaño de la ventana en milisegundos. */
  ventanaMs: number;
  /** Etiqueta legible para el mensaje de error. */
  etiqueta: string;
}

const MENSAJE_POR_DEFECTO = 'Demasiados intentos. Vuelva a intentarlo en un minuto.';

/** Ventana de los límites de autenticación (doc §8.2: intentos por minuto). */
export const VENTANA_INTENTOS_MS = 60_000;

/** Límites de login: 8/min por IP y 5/min por email. */
export const LOGIN_POR_IP = 8;
export const LOGIN_POR_EMAIL = 5;

/** Límites del paso MFA: 5/min (el TOTP son 6 dígitos). */
export const MFA_POR_IP = 5;
export const MFA_POR_IDENTIFICADOR = 5;

export class LimitadorIntentos {
  private readonly cubos = new Map<string, number[]>();
  private proximaPurga = 0;

  constructor(
    /** Ventana máxima usada: la purga descarta todo lo anterior a ella. */
    private readonly ventanaMaximaMs: number,
    /** Techo de claves retenidas; por encima se fuerza purga y se evicta lo más viejo. */
    private readonly maxClaves = 10_000,
    private readonly intervaloPurgaMs = 60_000,
  ) {}

  /**
   * Registra un intento en cada regla. Si alguna ya está agotada lanza 429 y
   * **no** consume el intento de las demás (así un bloqueo por IP no agota
   * también el contador del email y viceversa).
   */
  consumir(reglas: ReglaIntento[], mensaje: string = MENSAJE_POR_DEFECTO): void {
    const ahora = Date.now();
    this.purgar(ahora);
    for (const regla of reglas) {
      if (this.vigentes(regla, ahora).length >= regla.limite) {
        throw new HttpException(`${mensaje} (${regla.etiqueta})`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    for (const regla of reglas) {
      const intentos = this.vigentes(regla, ahora);
      intentos.push(ahora);
      this.cubos.set(regla.clave, intentos);
    }
  }

  private vigentes(regla: ReglaIntento, ahora: number): number[] {
    return (this.cubos.get(regla.clave) ?? []).filter((t) => ahora - t < regla.ventanaMs);
  }

  private purgar(ahora: number): void {
    if (ahora < this.proximaPurga && this.cubos.size <= this.maxClaves) return;
    this.proximaPurga = ahora + this.intervaloPurgaMs;
    for (const [clave, intentos] of this.cubos) {
      const vivos = intentos.filter((t) => ahora - t < this.ventanaMaximaMs);
      if (vivos.length === 0) this.cubos.delete(clave);
      else this.cubos.set(clave, vivos);
    }
    if (this.cubos.size > this.maxClaves) {
      // Defensa extra ante un flooding con claves siempre nuevas: se descartan
      // las claves con el último intento más antiguo.
      const sobran = [...this.cubos.entries()]
        .sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0))
        .slice(0, this.cubos.size - this.maxClaves);
      for (const [clave] of sobran) this.cubos.delete(clave);
    }
  }
}

/** Clave de contador por IP de origen. */
export function claveIp(ip?: string): string {
  return `ip:${ip && ip.length > 0 ? ip : 'desconocida'}`;
}

/** Clave de contador por identificador (email de login o `sub` del token MFA). */
export function claveIdentificador(valor: string): string {
  return `id:${valor.trim().toLowerCase()}`;
}

/** Reglas de `POST /auth/login` y `POST /platform/auth/login`. */
export function reglasLogin(ip: string | undefined, email: string): ReglaIntento[] {
  return [
    {
      clave: claveIp(ip),
      limite: limiteEnv('RATE_LIMIT_LOGIN_IP', LOGIN_POR_IP),
      ventanaMs: VENTANA_INTENTOS_MS,
      etiqueta: 'IP',
    },
    {
      clave: claveIdentificador(email),
      limite: limiteEnv('RATE_LIMIT_LOGIN_EMAIL', LOGIN_POR_EMAIL),
      ventanaMs: VENTANA_INTENTOS_MS,
      etiqueta: 'usuario',
    },
  ];
}

/** Reglas de `POST /platform/auth/mfa/verify` (más estrictas). */
export function reglasMfa(ip: string | undefined, identificador: string): ReglaIntento[] {
  return [
    {
      clave: claveIp(ip),
      limite: limiteEnv('RATE_LIMIT_MFA_IP', MFA_POR_IP),
      ventanaMs: VENTANA_INTENTOS_MS,
      etiqueta: 'IP',
    },
    {
      clave: claveIdentificador(identificador),
      limite: limiteEnv('RATE_LIMIT_MFA_ID', MFA_POR_IDENTIFICADOR),
      ventanaMs: VENTANA_INTENTOS_MS,
      etiqueta: 'usuario',
    },
  ];
}

/**
 * Límite configurable por entorno, con el valor estricto por defecto.
 *
 * Se lee en cada llamada (no al importar) para que el ajuste por despliegue y
 * las pruebas e2e funcionen sin depender del orden de importación. Subirlo es
 * una decisión de operación, no una forma de "desactivar" la protección: los
 * valores por defecto siguen siendo 8/5/5/5 por minuto.
 */
function limiteEnv(nombre: string, porDefecto: number): number {
  const v = Number(process.env[nombre]);
  return Number.isFinite(v) && v > 0 ? v : porDefecto;
}
