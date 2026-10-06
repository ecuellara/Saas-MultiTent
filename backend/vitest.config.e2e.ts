import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    // Las pruebas comparten base de datos: no pueden correr en paralelo.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Los specs hacen muchos logins desde la misma IP (y con el mismo email)
    // para ejercitar la autenticación, así que se relaja el límite de intentos
    // SOLO en el entorno de pruebas. Los valores por defecto de producción
    // (8/min por IP, 5/min por email) siguen intactos en el código.
    env: {
      RATE_LIMIT_LOGIN_IP: '10000',
      RATE_LIMIT_LOGIN_EMAIL: '10000',
      RATE_LIMIT_MFA_IP: '10000',
      RATE_LIMIT_MFA_ID: '10000',
      // Zona horaria del consultorio, FIJADA. Sin esto las pruebas dependen de la
      // zona del runner (CI corre en UTC) y un fallo de fechas como el de
      // `partesFecha` —que leía en local una fecha guardada en UTC— pasaría
      // desapercibido en CI y aparecería en producción.
      TZ: 'America/Lima',
    },
  },
});
