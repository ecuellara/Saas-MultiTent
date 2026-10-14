# Izipay: cobro del plan por suscripción (etapa 1)

> Decisión de producto (fija): Izipay es SOLO para que la clínica pague su
> suscripción/plan. `pagos` es registro INTERNO de la clínica (cobros a
> pacientes, abonos, anulación, arqueo), sin pasarela. La estructura lo
> garantiza: `IntentoIzipay` no puede referenciar un `Pago` (no existe la
> columna ni la relación) y `pagos` no importa nada de Izipay.

## Contrato implementado

- `POST /api/facturacion/mi-plan/formtoken` (`billing.manage`): crea el
  intento y el `formToken` para el `CobroSuscripcion` PENDIENTE del tenant (el
  más antiguo primero); si no hay ninguno, genera el del periodo con el
  `checkout` idempotente. Responde `{ formToken, publicKey, cobroId }`.
- `POST /api/facturacion/mi-plan/validar-retorno` (`billing.manage`): solo
  valida el resultado visual; JAMÁS marca nada como pagado.
- `GET /api/facturacion/mi-plan` (`billing.manage`): plan, suscripción, cobro
  pendiente y últimos cobros para la pantalla «Mi plan» y su resultado.
- `POST /api/webhooks/izipay` (público, firma como única autenticación):
  confirma con `BillingService.procesar` (cobro pagado + periodo extendido).
- El importe sale SIEMPRE del servidor (el cobro, o el precio del plan vía
  checkout). La petición del cliente no lleva importes y se ignoran si llegan.

## Firma y conciliación

`kr-answer` debe ser una **cadena**: HMAC-SHA256 sobre sus bytes UTF-8 exactos,
sin parsear, canonicalizar ni reemplazar caracteres antes de verificar.
`kr-hash` hexadecimal de 64 caracteres, comparación `timingSafeEqual`
(`core/pasarela/pasarela.ts`, sin cambios respecto a lo verificado en sandbox).
Solo algoritmo `kr-hash-algorithm=sha256_hmac` y selectores conocidos:

| Origen | `kr-hash-key` obligatorio | Variable de la clave |
|---|---|---|
| IPN público REST V4 | `password` | `IZIPAY_CLAVE` |
| Retorno del navegador, endpoint autenticado | `sha256_hmac` | `IZIPAY_CLAVE_HMAC` |

La firma de un origen no se admite en el endpoint del otro. Se comprueba el
`shopId` firmado contra el configurado. Para conciliar se requiere
`orderStatus=PAID`, transacción `status=PAID`, `uuid`, importe y moneda iguales
al intento, e intento existente. Estados del evento (`EventoIzipay.estado`):
`procesado`, `sin_cobro`, `importe_moneda_incorrectos`, `orden_desconocida`.
Una orden desconocida o un importe/moneda distinto se guardan para
conciliación y reciben 200 sin acreditar nada.

La clave persistente `izipay:<uuid>:PAYMENT_ACCEPTED` es única en PostgreSQL
(y es también el `eventId` de `WebhookEvent`). Evento, `procesar` (cobro
pagado + periodo extendido) y su registro corren **en una sola transacción**:
o se concilia todo, o no queda nada y el reintento del gateway puede
completarse. Ante repetición/concurrencia, la restricción única y la
recuperación `P2002` impiden acreditar dos veces y extender el periodo dos
veces. Un IPN tardío después de otro abono exige conciliación: no se salta
topes ni se resucita nada. No hay devoluciones automáticas.

`EventoIzipay` conserva `rawAnswer`, transacción, estado, importe, moneda,
`orderId`, tenant e intento derivados y `firmaValida=true`; no conserva claves
ni el hash. Una firma inválida responde 401 **sin ninguna escritura**. Los logs
HTTP no contienen payloads. El acceso a eventos crudos queda en backend/base:
aplicar la política de acceso y retención del comercio.

## Variables

`backend/.env.example` documenta las cinco variables obligatorias por entorno:
`IZIPAY_BASE_URL`, `IZIPAY_SHOP_ID`, `IZIPAY_CLAVE`, `IZIPAY_CLAVE_HMAC`,
`IZIPAY_PUBLIC_KEY`. No se añadió ninguna variable nueva. Sin configuración,
el uso devuelve 503 nombrando la faltante; la aplicación puede arrancar para
las clínicas que aún no usan la pasarela. No hay credenciales por defecto ni
secretos en el repositorio.

## Permisos

`billing.manage` (recurso `billing`, acción `manage`) en
`src/core/catalogo/permisos.ts` y en el fixture de pruebas. El alta de clínica
otorga el catálogo completo, así que el ADMIN la recibe sin pasos extra (tras
`db:seed`, que crea el permiso). `payments.write` es cobrar a pacientes y NO
sirve para el plan.

## Interfaz

Ruta `/mi-plan` (permiso `billing.manage`): plan, periodo y estado, cobro
pendiente con su importe y botón **«Pagar el plan»**. `PlanPagoModal.vue`
obtiene el token y carga Krypton solo al abrir (`services/izipay-form.ts`,
reutilizado sin cambios); al desmontar elimina formularios, callbacks y
recursos. Cerrar muestra cancelación; el resultado visual muestra rechazo o
«pendiente de confirmar». Con retorno `PAID` validado se navega a
`/mi-plan/resultado?cobro=<id>`, que consulta `GET mi-plan` hasta ver ese
cobro en `pagado` (nunca marca nada por su cuenta). Cerrar también recarga.
Las pantallas de pago del paciente no tienen botón, modal ni avisos de Izipay.

## Pruebas locales

`backend/test/izipay.e2e-spec.ts` inicia un stub HTTP en `127.0.0.1` con puerto
efímero. Ninguna petición sale a Izipay. Usa PostgreSQL real y la app con sus
guards, pipes, filtros y extensión tenant reales.

- Inyección del cliente ignorada: cobro 249.00 del plan, **24900 céntimos**,
  ida y vuelta Decimal; incluye 0.29 y rechazo de 1.001.
- Sin cobro pendiente se genera el del periodo (`proveedor: 'izipay'`,
  `chk-<tenant>-clinica-<YYYYMM>`); con pendiente se reutiliza el mismo cobro
  con intentos distintos.
- IPN válido con `kr-answer` indentado y saltos de línea: cobro `pagado`,
  periodo extendido; cabecera de otra clínica ignorada, esa clínica sin cobros.
- Tres IPN idénticos **simultáneos** más uno secuencial: todos 200, un evento,
  un `WebhookEvent`, periodo extendido una sola vez.
- Hash inválido: 401; cobro idéntico, cero eventos nuevos e igual cantidad de
  auditorías. Re-serializar el texto sin recalcular firma también devuelve 401.
- Orden desconocida, importe/moneda incorrectos, rechazo, algoritmo/selector
  desconocido, 403 sin permiso, 404 de los endpoints retirados de pagos, 503 sin
  configuración y reflejo en `GET mi-plan` (pendiente → pagado).
- Retorno del navegador con firma válida sin conciliar; IPN antes del retorno;
  firma inválida, claves cruzadas y conciliación/aislamiento.
- Invariante estructural: la fila de intento no tiene `pagoId`.

## Puesta en producción (opción elegida: migración)

Se aplica la **opción (a)**: migración `6_izipay_suscripciones` con
`migrate deploy` en el pre-despliegue de Render (ya cableado en
`render.yaml`: `preDeployCommand: npm run deploy:migrate`). Sin datos que
conservar, la migración vacía `IntentoIzipay` para exigir
`cobroSuscripcionId NOT NULL` desde el primer día; no hay capa de
compatibilidad. La alternativa (b) —reset total de Supabase— queda
documentada en la tarea y no fue necesaria.

Orden tras el despliegue: migración (pre-deploy) → `db:seed` (crea el permiso
`billing.manage`; el alta exige el catálogo completo) → alta de la clínica de
prueba desde el panel (su ADMIN ya recibe `billing.manage`).

Referencia general: [izipay-integracion.md](izipay-integracion.md). El diseño
anterior de pagos únicos a pacientes fue retirado del código; su documento
([izipay-pagos-unicos.md](izipay-pagos-unicos.md)) queda como referencia
histórica.

## Aceptación pendiente: sandbox real

Comprobación parcial ya realizada con credenciales TEST: `CreatePayment`
devuelve HTTP 200, `status: SUCCESS` y un formToken válido. Sigue pendiente la
aceptación del flujo de suscripción extremo a extremo:

1. Con las cinco variables TEST configuradas, abrir `/mi-plan` y pulsar
   «Pagar el plan» (el cobro del periodo se crea o reutiliza solo).
2. Pagar en SmartForm con tarjeta TEST.
3. Comprobar que `GET mi-plan` refleja el cobro `pagado` al llegar la IPN a
   `POST https://<api-real>.onrender.com/api/webhooks/izipay`.
4. Conciliar `IntentoIzipay`/`EventoIzipay`, importe y moneda, y periodo
   extendido exactamente una vez.
5. Reenviar **el mismo** IPN desde Back Office: saldo igual, un evento
   aceptado y periodo sin segunda extensión.
6. Alterar un byte de `kr-answer` manteniendo el hash: 401, sin cambiar
   cobros/eventos.
