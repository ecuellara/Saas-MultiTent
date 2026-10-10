# Imagen del backend (NestJS 12 + Prisma 7).
#
# Tres objetivos en un solo archivo:
#   - `runtime`      : lo que sirve tráfico (`node dist/main.js`). Solo
#                      dependencias de producción + cliente Prisma generado.
#   - `herramientas` : operaciones puntuales DENTRO de la red del compose
#                      (`prisma migrate deploy`, `db:seed`, `db:backup`...).
#                      Lleva las devDeps (prisma CLI, tsx) y el cliente de
#                      PostgreSQL, que el runtime no necesita.
#   - `build`        : etapa intermedia de compilación (no se despliega).
#
# Base `node:22-slim` (Debian) y NO alpine: los motores de Prisma y los
# módulos nativos (`argon2`, `bcrypt`) necesitan glibc; en alpine (musl)
# la generación del cliente y el arranque fallan de formas crípticas.
#
# Construir:
#   docker build -t dental-api:local --target runtime ./backend
#   docker build -t dental-herramientas:local --target herramientas ./backend

# ------------------------------------------------------------------ build ----
FROM node:22-slim AS build
WORKDIR /app
# `openssl` (el binario, no solo la lib): Prisma detecta la versión con él;
# sin él asume openssl-1.1.x y el motor descargado puede no cargar en runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# `prisma generate` NO conecta a la base, pero `prisma.config.ts` exige
# `DATABASE_URL` para resolver el datasource: marcador solo para compilar
# (no sale de esta etapa; el runtime recibe la URL real por entorno).
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate
RUN npm run build

# ----------------------------------------------------------------- runtime ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOADS_DIR=/app/uploads
ENV BACKUP_DIR=/app/backups
WORKDIR /app
# El postinstall de `@prisma/client` regenera el cliente: necesita el esquema
# presente ANTES del `npm ci`.
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --omit=dev
# El cliente Prisma generado NO sale del `npm ci --omit=dev` (el CLI de Prisma
# es devDependency y su postinstall no puede regenerar): se copia el ya
# generado en `build` (mismo lock, misma versión).
COPY --from=build /app/node_modules/@prisma/client /app/node_modules/@prisma/client
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/dist ./dist
# `uploads/` y `backups/` pertenecen al usuario de servicio: con volúmenes
# nombrados, Docker inicializa el volumen con esta propiedad y el backend
# puede escribir sin ser root.
RUN mkdir -p /app/uploads /app/backups && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ------------------------------------------------------------ herramientas ---
# Operaciones contra la base del compose sin instalar nada en el host:
#   docker compose -f compose.staging.yml run --rm herramientas \
#     npx prisma migrate deploy
#   docker compose -f compose.staging.yml run --rm herramientas \
#     npm run db:seed
# `db:seed` corre con `tsx` como en desarrollo (ver docs/despliegue.md): no se
# compilan los seeds a `dist/` para no duplicar el procedimiento.
FROM build AS herramientas
ENV NODE_ENV=production
# Cliente de PostgreSQL para `db:backup` / `db:restaurar` en modo local
# (`PG_DUMP_BIN`/`PG_RESTORE_BIN`); dentro del contenedor no hay demonio
# Docker al que hacer `docker exec`.
RUN apt-get update -y && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY scripts ./scripts
RUN mkdir -p /app/uploads /app/backups && chown -R node:node /app
USER node
CMD ["npx", "prisma", "migrate", "deploy"]
