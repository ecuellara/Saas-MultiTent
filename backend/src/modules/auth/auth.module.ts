import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * Secreto de firma de los JWT (doc §8.10: secretos solo por variables de
 * entorno). Fail-fast: un fallback hardcodeado permitía arrancar en producción
 * firmando —también los `temp_token` de MFA— con un secreto público.
 *
 * - `NODE_ENV=production`: `JWT_SECRET` es obligatorio y debe tener >= 32
 *   caracteres; si no, el proceso no arranca.
 * - Resto de entornos: se genera un secreto aleatorio **por arranque** (nunca
 *   una constante conocida); solo se reutiliza `JWT_SECRET` si es válido.
 */
export function resolverJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secreto = env.JWT_SECRET;
  if (env.NODE_ENV === 'production') {
    if (!secreto || secreto.length < 32) {
      throw new Error(
        'JWT_SECRET es obligatorio en producción y debe tener al menos 32 caracteres',
      );
    }
    return secreto;
  }
  if (secreto && secreto.length >= 32) return secreto;
  return randomBytes(48).toString('hex');
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: resolverJwtSecret(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
