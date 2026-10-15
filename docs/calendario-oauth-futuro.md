# Calendario: etapa futura con OAuth (NO implementada)

> Estado: **documento de diseño**. En esta etapa la agenda llega al celular del
> odontólogo por dos vías **sin OAuth y sin coste**: el feed ICS suscribible
> (`GET /api/agenda/:token.ics`, ver `FeedCalendario`) y el enlace «Añadir a
> Google Calendar» por cita (construido en el cliente). Nada de lo aquí descrito
> existe en el código: no hay proyecto en Google Cloud, no hay verificación de
> Google y no hay credenciales que rotar.

## Qué resolvería OAuth que el feed no resuelve

| Necesidad | Feed ICS (actual) | OAuth (futuro) |
|---|---|---|
| Ver la agenda en el celular | Sí (solo lectura, retardo de horas) | Sí |
| Crear/editar citas desde Google Calendar | No | Sí (sincronización bidireccional) |
| Push inmediato de cada cita | No (el cliente sondea cada pocas horas) | Sí (notificaciones push) |
| Recordatorios y videollamadas de Google | No | Sí |

## Diseño previsto (cuando se decida)

1. **Proyecto en Google Cloud** con la pantalla de consentimiento y el alcance
   `calendar.events` (mínimo necesario). Requiere verificación de Google si se
   publica fuera de pruebas internas.
2. **Modelo `GoogleAccount` (ya existe)**: guarda `refreshToken` cifrado por
   usuario y clínica. Nunca en claro, nunca en logs ni auditoría.
3. **Flujo**: conectar cuenta (consentimiento) → guardar refresh token →
   crear/actualizar/eliminar el evento de Google en cada cambio de cita
   (`googleEventId` ya existe en `Cita`) → renovar el token al caducar.
4. **Webhooks de Google** (canal push) para cambios hechos desde el lado de
   Google, con verificación de la firma del canal.

## Por qué no ahora

OAuth suma una superficie sensible (secretos de terceros, verificación externa,
cuotas de API) que no hace falta para el objetivo actual: ver la agenda
programada en el calendario del celular. El feed ICS cubre eso sin cuentas, sin
claves y sin coste, y el UID estable (`cita-<id>@dental-saas`) ya garantiza que
una reprogramación actualice el evento en lugar de duplicarlo.
