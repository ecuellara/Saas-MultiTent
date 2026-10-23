# Dental SaaS

SaaS multi-tenant para clínicas dentales: pacientes y expediente, agenda con reglas
de horario, pagos, inventario, consentimientos, configuración y panel de plataforma.

## Stack

- `backend/`: NestJS 12 + Prisma 7.10 + PostgreSQL (ESM; imports relativos con `.js`).
- `frontend/`: Vue 3.5 + Vite + Pinia + Tailwind 4, mobile-first.
- Multi-tenant con base compartida y `tenantId`; Render (API), Vercel (frontend) y
  Supabase (PostgreSQL).

## Requisitos

- Docker con el contenedor `dental-saas-test` (PostgreSQL 16, puerto **5433**).
- `npm`; los documentos no fijan versión de Node.js. Dos terminales (API y frontend).

> **Aviso:** pasos copiados de `AGENTS.md` y `docs/como-probar.md`. No se confirma la
> versión de Node.js ni cómo crear el contenedor: solo se documenta arrancarlo. Las
> credenciales de demo salen de los seeds y de `.env`; no se inventan aquí.

## PostgreSQL

```powershell
docker start dental-saas-test      # PostgreSQL 16 en el puerto 5433
```

## Backend

```powershell
cd E:\SAAS\backend
npm install
Copy-Item .env.example .env

# Base de datos de desarrollo (independiente de la de pruebas)
docker exec dental-saas-test psql -U postgres -c "CREATE DATABASE dental_saas_dev"

npx prisma migrate deploy     # aplica las migraciones
npx prisma generate           # REGENERA el cliente (ver aviso abajo)
npm run db:seed               # catálogo de permisos, planes y usuario de plataforma
npm run db:seed-demo          # clínica de demostración con la que entrar

npm run build                 # compila a dist/ con tsc
npm start                     # node dist/main.js
```

API: <http://localhost:3000/api> · Swagger: <http://localhost:3000/api/docs> · Salud: <http://localhost:3000/api/health>

> **Orden obligatorio:** `migrate deploy` y después `prisma generate`; si no, los
> campos nuevos responden 400. Arranca con `dist`, no con `tsx`: con `tsx` toda ruta
> autenticada devuelve 500.

## Frontend

```powershell
cd E:\SAAS\frontend
npm install
npm run dev
```

Abre <http://localhost:5173>. Vite proxya `/api` a `http://localhost:3000`.

## Pruebas

Backend (base real `dental_saas_test`):

```powershell
cd E:\SAAS\backend
$env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/dental_saas_test?sslmode=disable"
$env:JWT_SECRET   = "secreto-de-pruebas-de-al-menos-32-caracteres-ok"
npx vitest run --config vitest.config.e2e.ts
```
Frontend:
```powershell
cd E:\SAAS\frontend
npm run typecheck   # tipos y plantillas .vue
npm run build       # empaquetado real
```

Cadena de cierre completa en `AGENTS.md` §3. Detener con `Ctrl+C` y `docker stop dental-saas-test`.
