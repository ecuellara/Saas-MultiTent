# Cómo probar el sistema

Guía para levantar el sistema completo en local y recorrerlo con datos reales.
Todo lo que hay aquí está **verificado**: si sigues los pasos, funciona.

---

## 0. Resumen

```text
PostgreSQL (contenedor docker)   →   API NestJS (puerto 3000)
                                          ↑
                                     Frontend Vue (puerto 5173)
```

Necesitas **dos terminales** (API y frontend) y el contenedor de PostgreSQL.

---

## 1. PostgreSQL

Si ya tienes el contenedor de pruebas, sirve para desarrollo:

```powershell
docker start dental-saas-test      # PostgreSQL 16 en el puerto 5433
```

> El puerto es **5433** (no 5432) para no chocar con un PostgreSQL instalado.
> Usuario `postgres`, contraseña `test`.

## 2. Backend

```powershell
cd E:\SAAS\backend
npm install
```

Copia la plantilla de entorno y revísala (`.env` no se versiona):

```powershell
Copy-Item .env.example .env
```

`.env.example` explica cada variable. Para el entorno local ya hay valores que
funcionan; lo único que conviene cambiar son las contraseñas de los seeds.

Crea la base de datos y puebla:

```powershell
# Base de datos de desarrollo (independiente de la de pruebas)
docker exec dental-saas-test psql -U postgres -c "CREATE DATABASE dental_saas_dev"

npx prisma migrate deploy     # aplica las migraciones
npm run db:seed               # catálogo de permisos, planes y usuario de plataforma
npm run db:seed-demo          # clínica de demostración con la que entrar
```

Arranca la API:

```powershell
npm run build                 # compila a dist/ con tsc
npm start                     # node dist/main.js
```

- API: <http://localhost:3000/api>
- Documentación interactiva (Swagger): <http://localhost:3000/api/docs>
- Salud: <http://localhost:3000/api/health>

> **Por qué compilar y no usar `tsx`:** NestJS resuelve la inyección de
> dependencias con los **metadatos de decorador** (`design:paramtypes`). `tsx`
> transpila con esbuild, que **no emite** esos metadatos, así que el servidor
> arranca pero **toda ruta autenticada devuelve 500** (`this.reflector` es
> `undefined` en `JwtAuthGuard`). `tsc` sí los emite. Por el mismo motivo las
> pruebas e2e no lo detectaban: Vitest 4 transforma con Oxc, que sí los emite, y
> nunca pasan por `main.ts`.
>
> Si quieres recarga automática, ejecuta `npm run build` y reinicia; o usa
> `tsc -p tsconfig.build.json --watch` en una terminal y `npm start` en otra.

## 3. Frontend

```powershell
cd E:\SAAS\frontend
npm install
npm run dev
```

Abre <http://localhost:5173>.

En desarrollo **no hace falta configurar nada**: Vite proxya `/api` a
`http://localhost:3000`, de modo que el navegador ve un solo origen y no hay CORS
ni problemas con la cookie del refresh.

## 4. Entrar

Con lo que crea `npm run db:seed-demo`:

| Qué | Valor |
|---|---|
| URL | <http://localhost:5173/login> |
| Correo | `dentista@demo.pe` |
| Contraseña | `Clinica-Demo-2026!` (la de `DEMO_OWNER_PASSWORD`) |
| Clínica | Clínica Demo (rol ADMIN, los 14 permisos) |

Al entrar, como la cuenta pertenece a **una sola** clínica, la aplicación la
selecciona sola y va al panel. Con más de una clínica aparece el selector.

## 5. Qué puedes recorrer

- **Panel**: la sesión resuelta — clínica, rol, permisos efectivos y las features
  del plan.
- **Pacientes**: listado, búsqueda, alta con la ficha clínica completa, y el
  expediente por pestañas (datos, historial, documentos, odontogramas).
  - **Documentos**: adjunta un PNG/JPEG/PDF de menos de 20 MB y descárgalo. Prueba
    a renombrar un `.txt` a `.png`: se rechaza, porque el servidor mira el
    **contenido** y no la extensión.
- **Agenda**: vista del día con dos citas de ejemplo. Crea una cita (al elegir
  tratamiento se calcula sola la hora de fin).
  La clínica demo trae horario configurado —lunes a viernes 09:00-19:00, sábado
  09:00-13:00, domingo cerrado— así que puedes ver las reglas en acción:
  - un **domingo** → «El consultorio no atiende el día dom»;
  - un **sábado a las 15:00** → «La cita está fuera del horario de atención (sab 09:00-13:00)»;
  - una **hora de hoy que ya pasó** → «No se puede agendar en el pasado: la franja … ya pasó»;
  - **solapar** con una cita existente → «La cita se solapa con otra existente».

  Las cuatro las valida el backend; el formulario, además, no ofrece días anteriores a hoy.
- **Pagos**: listado con buscador y filtro por estado, alta (total o parcial,
  con detalle por tratamiento y plan de cuotas opcional), abonos hasta saldar
  y anulación con confirmación. Desde cada cita no cancelada de la agenda, el
  botón **Cobrar** abre el formulario ya vinculado a esa cita y su paciente.
- **Inventario**: insumos con aviso de stock bajo mínimo, entradas y salidas
  con motivo, y alta. **Proveedores**: lista, alta y edición.
  **Compras**: alta con líneas (el total lo calcula el servidor) y detalle;
  al registrar, el stock sube y se genera el egreso en la misma operación.
- **Configuración**: datos de la clínica, horario semanal (7 filas con
  `<input type="time">`) y descansos. Sin permiso de gestión se ve en solo
  lectura. Prueba poner el sábado hasta las 13:00 y agendar a las 14:00:
  la API responde 400.

## 6. Panel de plataforma

Es un área separada (`/admin`, con su propio layout y su propia sesión: no usa
la sesión de clínica). Entra en <http://localhost:5173/admin/login> con el
usuario de `npm run db:seed`:

| Qué | Valor |
|---|---|
| Correo | `owner@demo.pe` |
| Contraseña | `Plataforma-Demo-2026!` (la de `PLATFORM_OWNER_PASSWORD`) |

La MFA es **obligatoria**: el primer login devuelve un temporal de alta, la
pantalla muestra el secreto TOTP para enrolarlo en la app autenticadora, se
confirma con un código de 6 dígitos y desde entonces cada login pide el código.

Desde el panel se puede: ver la lista de clínicas, dar de **alta** una clínica
completa (tenant + sede + rol ADMIN + dueño + suscripción, en una transacción),
**suspender/reactivar**, **asignar plan**, ver **métricas** y descargar el
**export** JSON por tenant.

Por API directa también funciona (cabecera `Authorization: Bearer <token>`
de plataforma, sin `X-Tenant-Id`):

```powershell
$base = 'http://localhost:3000/api'
Invoke-RestMethod -Method Post -Uri "$base/platform/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = 'owner@demo.pe'; password = 'Plataforma-Demo-2026!' } | ConvertTo-Json)
```

## 7. Pruebas automáticas

```powershell
cd E:\SAAS\backend
$env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/dental_saas_test?sslmode=disable"
$env:JWT_SECRET   = "secreto-de-pruebas-de-al-menos-32-caracteres-ok"
npx vitest run --config vitest.config.e2e.ts
```

Son **183 pruebas** sobre una base de datos real (usan `dental_saas_test`, no
`dental_saas_dev`: no se pisan con tu entorno de desarrollo).

Frontend:

```powershell
cd E:\SAAS\frontend
npm run typecheck   # tipos y plantillas .vue
npm run build       # empaquetado real
```

## 8. Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `Error interno` (500) en **toda** ruta autenticada | Arrancaste con `tsx` en lugar de `dist` compilado. Ver §2 |
| `Can't reach database server` | El contenedor no está levantado, o el puerto de `DATABASE_URL` no es 5433 |
| El frontend carga pero todo da error | La API no está en el 3000, o `VITE_API_PROXY` apunta a otro sitio |
| `Faltan PLATFORM_OWNER_EMAIL / DEMO_OWNER_PASSWORD` | Los seeds exigen esas variables: están en `.env` |
| `Falta el plan «clinica»` | Ejecuta `npm run db:seed` **antes** de `npm run db:seed-demo` |
| Sesión perdida al reiniciar la API | En desarrollo, sin `JWT_SECRET` se genera uno aleatorio por arranque |

## 9. Detener

```powershell
# Ctrl+C en cada terminal, y si quieres parar la base de datos:
docker stop dental-saas-test
```
