# Frontend: build estático (Vite) servido por nginx.
#
# No hay contenedor de Node para servir ficheros: nginx entrega `dist/` y
# proxya `/api` al backend. El build se hace con `VITE_API_URL` VACÍA para
# que el navegador use `/api` relativo (mismo origen): así no hay CORS que
# configurar y el refresh en cookie httpOnly viaja sin fricción.
# Si el frontend y la API viven en orígenes distintos, construye con
# `VITE_API_URL=https://api.tu-dominio` en su lugar.
#
# Construir:
#   docker build -t dental-web:local ./frontend

# ------------------------------------------------------------------ build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vacía a propósito: `/api` relativo, lo resuelve el proxy de este nginx.
ENV VITE_API_URL=
RUN npm run build

# ----------------------------------------------------------------- runtime ---
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
