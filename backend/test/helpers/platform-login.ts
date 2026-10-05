/**
 * Login de plataforma con MFA (ADR-004).
 *
 * Desde que la MFA es OBLIGATORIA y falla en cerrado, un `PlatformUser` sin
 * TOTP enrolado NO recibe un token de acceso: el login devuelve
 * `{ mfa_required, mfa_setup_required, temp_token }` y ese temporal solo sirve
 * para `/platform/auth/mfa/setup` y `/platform/auth/mfa/confirm`.
 *
 * Este helper hace el ciclo completo y devuelve un access token de plataforma
 * utilizable, para que los specs no tengan que replicar el flujo.
 */
import request from 'supertest';
import { generarCodigoTotp } from '../../src/core/auth/totp.js';

type Servidor = Parameters<typeof request>[0];

export interface SesionPlataforma {
  access: string;
  secret: string;
}

export async function loginPlataformaConMfa(
  srv: Servidor,
  email: string,
  password: string,
  secretExistente?: string,
): Promise<SesionPlataforma> {
  const login = () =>
    request(srv).post('/api/platform/auth/login').send({ email, password }).expect(200);

  let r = await login();

  // Ya tiene MFA enrolada: el login devuelve un temporal para verificar.
  if (r.body.mfa_required && !r.body.mfa_setup_required) {
    if (!secretExistente) {
      throw new Error(
        `${email}: MFA ya enrolada; pasa el secret conocido para poder verificar el TOTP`,
      );
    }
    const verificado = await request(srv)
      .post('/api/platform/auth/mfa/verify')
      .send({ temp_token: r.body.temp_token, code: await generarCodigoTotp(secretExistente) })
      .expect(200);
    return { access: verificado.body.access_token as string, secret: secretExistente };
  }

  // Sin MFA: el temporal solo vale para enrolar.
  if (r.body.mfa_setup_required) {
    const temp = r.body.temp_token as string;
    const setup = await request(srv)
      .post('/api/platform/auth/mfa/setup')
      .set('Authorization', `Bearer ${temp}`)
      .expect(200);
    const secret = setup.body.secret as string;
    await request(srv)
      .post('/api/platform/auth/mfa/confirm')
      .set('Authorization', `Bearer ${temp}`)
      .send({ code: await generarCodigoTotp(secret) })
      .expect(200);

    // Con la MFA ya enrolada, el login pasa a pedir el código.
    r = await login();
    const verificado = await request(srv)
      .post('/api/platform/auth/mfa/verify')
      .send({ temp_token: r.body.temp_token, code: await generarCodigoTotp(secret) })
      .expect(200);
    return { access: verificado.body.access_token as string, secret };
  }

  return { access: r.body.access_token as string, secret: '' };
}
