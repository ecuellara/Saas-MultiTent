# Proxy `/api` en Cloudflare Pages

`functions/api/[[ruta]].ts` reenvía cualquier petición `/api/*` a la API de Render
sin cambiar de origen, para que la cookie de sesión `SameSite=Strict` siga funcionando.

Configura en Cloudflare Pages (Settings → Environment variables) la variable:

- `API_ORIGIN` = `https://<api>.onrender.com` (solo el origen: sin `/api`,
  sin barra final y sin credenciales). Aplícala a Production y Preview.

El cuerpo de la petición se reenvía como stream (sin bufferizar) y la respuesta
se devuelve tal cual, incluidos `Set-Cookie`. `VITE_API_URL` debe seguir vacía.
