# Izipay: etapa 1 — pagos únicos al paciente

## Contrato implementado

- `POST /api/pagos/:id/izipay/formtoken`: JWT, tenant validado y
  `payments.write`. Sin DTO de entrada: cualquier importe, estado u `orderId`
  enviado por el cliente se ignora. Se cobra el **saldo Decimal del servidor**.
  Solo ingresos de pacientes, pendientes/parciales, no eliminados ni anulados.
- Backend → `{IZIPAY_BASE_URL}/api-payment/V4/Charge/CreatePayment`, Basic auth
  `IZIPAY_SHOP_ID:IZIPAY_CLAVE`, moneda PEN e importe entero en céntimos.
  Se guarda antes de llamar el intento con `orderId` UUID único, pago, tenant,
  usuario solicitante, importe y metadata. No se persiste el formToken.
- Respuesta al navegador: exclusivamente `{ formToken, publicKey }`.
- `POST /api/pagos/:id/izipay/validar`: JWT, tenant y `payments.write`.
  Valida el retorno del navegador con la clave HMAC, orden, pago, clínica,
  importe y moneda del intento. Devuelve `{ valido: true, orderStatus }`.
  **No abona ni persiste eventos de IPN**, incluso cuando responde PAID.
- `POST /api/webhooks/izipay`: público, acepta JSON y form-urlencoded. El tenant
  se resuelve desde el intento asociado al `orderDetails.orderId` **firmado**.
  No se usa la cabecera de tenant ni metadata del aviso para atribuir el abono.

## Firma y conciliación

`kr-answer` debe ser una **cadena**: HMAC-SHA256 sobre sus bytes UTF-8 exactos,
sin parsear, canonicalizar ni reemplazar caracteres antes de verificar.
`kr-hash` hexadecimal de 64 caracteres, comparación `timingSafeEqual`.
Solo algoritmo `kr-hash-algorithm=sha256_hmac` y selectores conocidos:

| Origen | `kr-hash-key` obligatorio | Variable de la clave |
|---|---|---|
| IPN público REST V4 | `password` | `IZIPAY_CLAVE` |
| Retorno del navegador, endpoint autenticado | `sha256_hmac` | `IZIPAY_CLAVE_HMAC` |

La firma de un origen no se admite en el endpoint del otro.

Se comprueba el `shopId` firmado contra el configurado. Para abonar se requiere
`orderStatus=PAID`, transacción `status=PAID`, `uuid`, importe y moneda iguales
al intento. Estados distintos se auditan sin abono; una orden desconocida o un
importe/moneda distinto se guardan para conciliación y reciben 200 sin cobrar.

La clave persistente `izipay:<uuid>:PAYMENT_ACCEPTED` es única en PostgreSQL.
Evento, `PagosService.abonar` y auditoría del abono se escriben **en una sola
transacción**. Ante repetición/concurrencia, la restricción única y recuperación
`P2002` impiden abonos duplicados. Si el abono supera el tope o encuentra una
carrera, se revierte también el evento para permitir un reintento auténtico.
Un IPN tardío después de otro abono o una anulación exige conciliación: no se
salta el tope ni se resucita el pago. No hay devoluciones automáticas.

`EventoIzipay` conserva `rawAnswer`, transacción, estado, importe, moneda,
orderId, tenant derivado y `firmaValida=true`; no conserva claves ni el hash.
La auditoría del abono identifica proveedor y usuario que solicitó el intento.
Una firma inválida responde 401 **sin ninguna escritura** (también se excluye
del interceptor genérico de auditoría). Los logs HTTP no contienen payloads.
El acceso a eventos crudos queda en backend/base: aplicar la política de acceso
y retención del comercio a estos datos de conciliación.

## Variables

`backend/.env.example` documenta las cinco variables obligatorias por entorno:
`IZIPAY_BASE_URL`, `IZIPAY_SHOP_ID`, `IZIPAY_CLAVE`, `IZIPAY_CLAVE_HMAC`,
`IZIPAY_PUBLIC_KEY`. Sin configuración, el uso devuelve 503; la aplicación puede
arrancar para las clínicas que aún no usan la pasarela. No hay credenciales por
defecto ni variables nuevas en compose.

## Interfaz

En el detalle: «Cobrar en línea», con permiso de escritura y saldo pendiente de
un ingreso al paciente. `IzipayModal.vue` obtiene el token y el adaptador
`frontend/src/services/izipay-form.ts` usa **KRGlue**
(`@lyracom/embedded-form-glue`, versión fijada 1.4.4). Carga Krypton solo al abrir,
con timeout y cancelación, y llama a `KRGlue.loadLibrary` con la clave pública
devuelta por backend. El contenedor usa **SmartForm con tema Neon**:

```html
<div id="micuentawebstd_rest_wrapper">
  <div id="izipay-container">
    <div class="kr-smart-form" kr-card-form-expanded></div>
  </div>
</div>
```

Los recursos `ext/neon-reset.min.css` y `ext/neon.js` se cargan en el `<head>`
después de Krypton y antes de configurar/montar el formulario. El formToken se
asigna mediante `KR.setFormConfig`, sin credenciales fijas en HTML ni recursos
de pago en `index.html`. Al desmontar se eliminan formularios, callbacks,
scripts y CSS; el singleton de KRGlue se reinicia para permitir la reapertura.
La limpieza y la apertura siguiente se serializan para evitar carreras.
`izipay-glue.ts` normaliza el export CommonJS de KRGlue antes de usarlo:
Vite puede entregarlo envuelto en `default`, en lugar de la instancia directa.
`npm run test:izipay` en frontend prueba el import del paquete real, su
`loadLibrary` y la reapertura después del reset con DOM simulado y sin red.
Cerrar muestra cancelación; `KR.onSubmit` envía exclusivamente el texto firmado,
hash y selectores a `/pagos/:id/izipay/validar`. Solo después de validarlo se
muestra rechazo o «pendiente de confirmar»; si falla se indica resultado sin
verificar. Cuando la validación devuelve `orderStatus: PAID`, se cierra el modal
y Vue Router navega a `/pagos/:id/resultado`. Se sigue devolviendo `false` desde
`KR.onSubmit` para evitar el POST/redireccionamiento automático del proveedor:
la aplicación gestiona el destino después de verificar la firma.

La pantalla de resultado consulta GET del pago al entrar y cada dos segundos,
hasta 16 consultas, mientras esté pendiente/parcial. Solo muestra «Pago
confirmado» cuando GET devuelve `estado: pagado`. Si el IPN tarda, permanece
«pendiente de confirmar» y permite actualizar manualmente. Detiene el sondeo
al confirmar, anular, encontrar un error o salir de la pantalla.
El resultado y «Actualizar estado» consultan GET del
pago. Cerrar manualmente también recarga. **Nunca se envía un abono desde el formulario**:
solo el IPN cambia el estado persistido.

Referencia Vue oficial:
[Embedded-PaymentForm-Vue.js](https://github.com/izipay-pe/Embedded-PaymentForm-Vue.js).

## Pruebas locales

`backend/test/izipay.e2e-spec.ts` inicia un stub HTTP en `127.0.0.1` con puerto
efímero. Ninguna petición sale a Izipay. Usa PostgreSQL real y la app con sus
guards, pipes, filtros y extensión tenant reales.

- Inyección del cliente ignorada: total 180.50, abono previo 60.00, saldo
  **120.50 → 12050**, ida y vuelta Decimal; incluye 0.29 y rechazo de 1.001.
- IPN válido con `kr-answer` indentado y saltos de línea: saldo cero; cabecera
  de otra clínica ignorada, esa clínica no cambia; form-urlencoded real.
- Hash inválido: 401; fila completa del pago idéntica, cero eventos nuevos e
  igual cantidad de auditorías. Re-serializar el texto sin recalcular firma
  también devuelve 401.
- Tres IPN idénticos **simultáneos**, seguidos por otro secuencial: todos 200,
  un evento, una auditoría de abono y un único incremento de 120.50.
- Orden desconocida, importe/moneda incorrectos, rechazo, IPN tardío y rollback,
  algoritmo/selector desconocido, 403 sin permiso, 404 entre clínicas, 503 sin
  configuración y 400 para pagos anulados/saldados.
- Retorno del navegador con firma válida sin abono, IPN antes del retorno,
  firma inválida, claves cruzadas entre endpoints y conciliación/aislamiento.

## Comparación con los ejemplos locales de E:\izipay

Referencias revisadas: `Embedded-PaymentForm-Vue.js/src/components/CheckoutStore.vue`,
`AddForm.vue`, `AttachForm.vue`, `public/index.html` y
`Server-PaymentForm-NodeJS/controllers/paidController.js`, `routes/index.js`.

Se conserva el flujo `loadLibrary → setFormConfig → onSubmit → montar → showForm`
y el tema Neon. El ejemplo usa `addForm` sobre un contenedor vacío; el SaaS usa
`renderElements` sobre su markup SmartForm propio, sustituyendo `attachForm`,
marcado como deprecado por Krypton. La validación del retorno se
incorpora con firma raw y comparación constante, y el IPN utiliza password REST.

Para pago único se omite el parámetro opcional `formAction`, utilizando el flujo
predeterminado de `CreatePayment`; `PAY` es un valor inválido (sandbox: INT_875).
El ejemplo local usa `ASK_REGISTER_PAY`, que también pide registrar el medio de
pago. Los errores REST se comprueban incluso dentro de HTTP 200, y el diagnóstico
expone solo códigos acotados, nunca el payload ni las credenciales. Los datos del
comprador salen del paciente del SaaS; no se fabrican ciudad, departamento ni
código postal cuando no existen en su ficha. Credenciales y órdenes se resuelven
en servidor; los intentos y abonos tienen persistencia e idempotencia PostgreSQL.

## Aceptación pendiente: sandbox real

Comprobación parcial realizada con credenciales TEST: `CreatePayment` devuelve
HTTP 200, `status: SUCCESS` y un formToken válido al omitir `formAction`.
La petición se ejecutó mediante el servicio del SaaS sobre un pago pendiente;
solo creó un intento, sin enviar tarjeta ni registrar un abono. Sigue pendiente
la aceptación del formulario en navegador y el IPN público extremo a extremo.

1. Obtener del Back Office las credenciales TEST REST V4 del comercio: shopId,
   password REST, clave HMAC y clave pública; confirmar el origen REST y
   configurar las cinco variables fuera del repositorio.
2. Publicar una URL HTTPS accesible por Izipay:
   `https://<host-api>/api/webhooks/izipay`. Configurar la notificación en el
   Back Office para pagos aceptados/rechazados, independientes del navegador.
3. Confirmar con un aviso TEST real los selectores de firma de la tabla,
   `shopId`, estados y formato `orderDetails`/`transactions`. La aceptación
   local valida el contrato, no sustituye esta comprobación.
4. Abrir el formulario en navegador y probar tarjetas oficiales TEST:
   aprobado, rechazado, cancelación, cierre temprano y reapertura. Verificar
   carga/limpieza de Krypton y, si aplica, habilitar el dominio del frontend.
5. Demorar el IPN: la pantalla debe seguir pendiente hasta que llegue. Reenviar
   el mismo aviso desde Back Office y comprobar un único abono; alterar un byte
   del texto firmado y comprobar 401 sin cambios. Conciliar céntimos y saldo.

Referencia general: [izipay-integracion.md](izipay-integracion.md).
