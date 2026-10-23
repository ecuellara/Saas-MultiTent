# Deuda tÃ©cnica â€” Dental SaaS

> **Estado:** registro vivo. Ãšltima actualizaciÃ³n: octubre 2026.
> **Regla:** este documento no es una lista de deseos. Cada entrada tiene un motivo
> por el que **hoy** no se hace, y un disparador que la reactiva.

---

## 1. PropÃ³sito

Concentrar en un solo lugar lo que se decidiÃ³ **no** hacer todavÃ­a, para que no se
pierda ni se confunda con un bug pendiente. Lo que sÃ­ estÃ¡ corregido y verificado
vive en el cÃ³digo y en [plan-pruebas-aislamiento.md](plan-pruebas-aislamiento.md).

> Este documento registra **solo lo que sigue abierto**. Cuando una entrada se
> cierra, se retira de aquÃ­ (el histÃ³rico estÃ¡ en el repositorio, no en la lista).

---

## 2. Integraciones de pago (deuda aceptada)

### 2.1 DecisiÃ³n

**Se integra Ãºnicamente con Izipay**. La etapa 1 (cobro del plan por
suscripciÃ³n) estÃ¡ implementada contra un stub local; queda la aceptaciÃ³n con
credenciales TEST y URL pÃºblica del IPN, descrita
en [izipay-suscripcion.md](izipay-suscripcion.md). El alcance se harÃ¡ en tres
etapas, en este orden:

| Etapa | Alcance | Producto y modo |
|---|---|---|
| **1** | **SuscripciÃ³n** (cobro del plan a la clÃ­nica) | Izipay **REST V4.0** (`micuentaweb`) â€” **formulario incrustado** a partir de un `formToken` |
| **2** | **Recurrencia** (cobro automÃ¡tico sin intervenciÃ³n) | **La MISMA documentaciÃ³n** REST V4.0 (`CreatePayment`); cambia la periodicidad y el guardado del token |
| **3** | MigraciÃ³n a la experiencia nueva | Izipay **web-core**, modalidad **embebido** (SDK y esquema de firma distintos) |

**Motivo de aplazarlo:** la facturaciÃ³n del SaaS sigue siendo **manual** por el
panel de plataforma (ADR-008) y eso es suficiente para las primeras clÃ­nicas. No
hay urgencia de negocio que justifique asumir ahora el coste de una integraciÃ³n
de pagos (credenciales, conciliaciÃ³n, devoluciones, soporte del gateway).

**Disparador de la etapa 1 (cumplido):** decisiÃ³n de producto â€” la pasarela es
SOLO para que la clÃ­nica pague su suscripciÃ³n/plan. `pagos` queda como
registro INTERNO (cobros a pacientes, abonos, anulaciÃ³n, arqueo), sin pasarela;
la estructura lo garantiza (`IntentoIzipay` no referencia `Pago`).

**Disparador de la etapa 2:** mÃ¡s clÃ­nicas de las que se puedan facturar a mano.

> **Devoluciones:** quedan **fuera** de este alcance y usan **otra documentaciÃ³n**
> del proveedor (API de `refund`), distinta de `CreatePayment`. Cuando se pidan,
> tratar como una entrada nueva, no como una extensiÃ³n de la etapa 1.

### 2.1.1 Flujo implementado: cobro del plan (REST V4, formulario incrustado)

> El diseÃ±o anterior de pago Ãºnico **al paciente** quedÃ³ retirado del cÃ³digo
> por decisiÃ³n de producto (ver [izipay-suscripcion.md](izipay-suscripcion.md)).
> Se conserva aquÃ­ su flujo como referencia histÃ³rica; los endpoints
> `/pagos/:id/izipay/*` ya no existen.

```text
1. Frontend  â†’  POST <api>/facturacion/mi-plan/formtoken   (sin cuerpo)
2. Backend   â†’  cobro PENDIENTE del tenant (o checkout idempotente del periodo)
              POST https://api.micuentaweb.pe/api-payment/V4/Charge/CreatePayment
              Authorization: Basic BASE64(SHOP_ID:CLAVE)
              â† { status: "SUCCESS", answer: { formToken } }
3. Frontend  â†  { formToken, publicKey, cobroId }  (nada mÃ¡s: ni usuario ni clave)
4. Frontend  â†’  KRGlue.loadLibrary('https://static.micuentaweb.pe', publicKey)
              KR.setFormConfig({ formToken, 'kr-language': 'es-ES' })
              KR.renderElements('#izipay-container') â†’ KR.showForm(result.formId)
5. Usuario paga en el formulario incrustado en nuestro <div>
6. Frontend  â†’  KR.onSubmit â†’ POST <api>/facturacion/mi-plan/validar-retorno
              { 'kr-answer', 'kr-hash', 'kr-hash-key', 'kr-hash-algorithm' }
7. Backend   â†’  valida firma â†’ compara con el intento (importe, moneda, tenant)
              â†’ responde { valido, orderStatus } SIN acreditar nada
8. Izipay    â†’  IPN servidor-a-servidor a POST <api>/webhooks/izipay
              â†’ BillingService.procesar (cobro pagado + periodo extendido)
              â† FUENTE DE VERDAD
```

Datos concretos que hay que respetar:

- **El importe viaja en unidades mÃ­nimas**: `S/ 249.00 â†’ 24900` (`amount * 100`,
  con `Prisma.Decimal`, sin coma flotante).
- Cuerpo de `CreatePayment`: `amount`, `currency` (`PEN`), `orderId`,
  `metadata` (con `cobroSuscripcionId`) y `customer` con los datos de la
  clÃ­nica (`TenantConfig`: nombre, email, telÃ©fono).
- El HTML necesita un contenedor propio:
  `<div id="micuentawebstd_rest_wrapper"><div id="izipay-container"><div class="kr-smart-form" kr-card-form-expanded></div></div></div>`,
  mÃ¡s los recursos CSS/JS del cliente Krypton (tema Neon).
- La librerÃ­a del formulario es `@lyracom/embedded-form-glue`.

Reglas que no se deben reinterpretar:

- **Las credenciales viven solo en el backend.** El navegador recibe Ãºnicamente
  `formToken` y `publicKey`; nunca usuario, contraseÃ±a ni la clave HMAC.
- El **`formToken` no se puede fabricar en el cliente**: lo emite Izipay a
  peticiÃ³n del backend.
- **El frontend no confirma el pago.** Un `if (frontendPaymentSuccess)` que ponga
  el pedido en `PAID` es exactamente lo que hay que evitar: la confirmaciÃ³n pasa
  por validaciÃ³n de firma + importe + orden + **IPN**.
- **La IPN es la fuente de verdad** y se procesa de forma **idempotente**.
- El endpoint `POST /api/webhooks/izipay` debe estar **fuera** de la autenticaciÃ³n
  normal (es servidor a servidor) y validar la firma antes de tocar nada.
- **La pasarela nunca toca `pagos`.** El mÃ³dulo de clÃ­nica (cobros a pacientes,
  abonos, anulaciÃ³n, arqueo) no importa nada de Izipay; la tabla de intentos
  referencia `CobroSuscripcion`, nunca `Pago`.

### 2.1.2 Flujo de suscripciones: mismo producto, operaciones adicionales

Comparte producto, credenciales y validaciÃ³n de firma con el pago Ãºnico (es la
misma referencia REST V4), pero **no es una variaciÃ³n del pago Ãºnico**: aÃ±ade
tokenizaciÃ³n y recurrencia, y su modelo de datos es distinto.

```text
1. Cliente registra la tarjeta   â†’  Izipay guarda los datos sensibles
2. Backend: POST /api-payment/V4/Charge/CreateToken        â†’  paymentMethodToken
3. Backend guarda el token (NUNCA el PAN ni el CVV)
4. Backend: POST /api-payment/V4/Charge/CreateSubscription
   { amount, currency, effectDate, paymentMethodToken, rrule, orderId }
   â†’  { subscriptionId }
5. Cada renovaciÃ³n es una TRANSACCIÃ“N INDEPENDIENTE (no una sola)
6. CancelaciÃ³n: POST /api-payment/V4/Subscription/Cancel
```

- La recurrencia se define con **RRULE (iCalendar/RFC5545)**: por ejemplo
  `RRULE:FREQ=MONTHLY;INTERVAL=1`, `FREQ=WEEKLY;INTERVAL=2`,
  `FREQ=MONTHLY;COUNT=12` (12 meses).
- **`effectDate` es delicado**: mal calculado provoca doble cobro, una primera
  cuota inesperada, fechas en pasado o corrimientos por zona horaria. En algunos
  flujos se recomienda que la recurrencia empiece **despuÃ©s** de la creaciÃ³n para
  no duplicar el primer pago.
- El **precio lo pone el backend desde el plan almacenado**, nunca el cliente
  (si no, un `amount: 0.01` cambiarÃ­a el precio de la suscripciÃ³n).
- **La recurrencia debe estar habilitada por Izipay** para el comercio/MID: hay
  que confirmarlo antes de prometer la funciÃ³n.

**RelaciÃ³n de datos:** 1 cliente â†’ N suscripciones â†’ N transacciones. Mezclar la
suscripciÃ³n con una Ãºnica transacciÃ³n impide cambiar de plan, reintentar, cancelar
y reportar.

### 2.1.3 Referencias

EspecificaciÃ³n tÃ©cnica completa (la que aportÃ³ el usuario, copiada al repositorio):
- [izipay-integracion.md](izipay-integracion.md) â€” arquitectura, endpoints,
  payloads, RRULE, modelo de datos, estados, idempotencia, seguridad, logging,
  pruebas y checklist de producciÃ³n

Ejemplo oficial a seguir:
- [Embedded-PaymentForm-React](https://github.com/izipay-pe/Embedded-PaymentForm-React) â€” flujo completo comentado (formtoken â†’ librerÃ­a â†’ onSubmit â†’ validaciÃ³n â†’ IPN)

API y guÃ­as:
- [Referencia API REST V4](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/reference.html)
- [`CreatePayment`](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/playground/Charge/CreatePayment)
- [SmartForm / Quick Start](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/javascript/redirection/quick_start_smartform.html)
- [Formulario incrustado: prueba rÃ¡pida](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/javascript/quick_start_js.html)
- [Analizar el resultado del pago](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/kb/payment_done.html)
- [Analizar la IPN](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/kb/ipn_usage.html)
- [Tarjetas de prueba](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/kb/test_cards.html)
- [Obtener credenciales del Back Office](https://github.com/izipay-pe/obtener-credenciales-de-conexion)
- Servidor de referencia en nuestro stack: [Server-PaymentForm-NodeJS](https://github.com/izipay-pe/Server-PaymentForm-NodeJS)
- TokenizaciÃ³n y recurrencia (Lyra Collect): [documento tÃ©cnico](https://docs.lyra.com/content/lyradoc/en/collect/form-payment/subscription-token/tla1430209986491.pdf)

Producto nuevo (etapa 3):
- [web-core â€” Embebido](https://developers.izipay.pe/web-core/modalidades/embebido/)
- [web-core â€” ValidaciÃ³n de firma](https://developers.izipay.pe/web-core/modalidades/firma-validation/)
- [web-core â€” Servicio de notificaciones (IPN)](https://developers.izipay.pe/web-core/notifications/)

### 2.2 QuÃ© existe hoy en el cÃ³digo

**Ya estÃ¡ hecho y es reutilizable** (no es deuda):

- El modelo de planes y suscripciones: `Plan`, `PlanFeature`, `Subscription`
  (estados `TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED | EXPIRED`),
  `EntitlementsService` con lÃ­mites y features, y el **dunning** que degrada a
  `PAST_DUE` y luego `SUSPENDED` cortando el acceso al tenant.
- La **idempotencia** del alta de cobro (`CobroSuscripcion.claveIdempotencia`
  Ãºnica + recuperaciÃ³n ante la carrera `P2002`).
- El **registro de eventos** de webhook (`WebhookEvent.eventId` Ãºnico) con
  detecciÃ³n de duplicados.
- El panel de plataforma para asignar plan y suspender/reactivar clÃ­nicas
  (`@PlatformRoles`), que sirve tal cual para la facturaciÃ³n manual.

**Es lo que se retira o se reescribe con Izipay:**

| Archivo | QuÃ© es | Destino |
|---|---|---|
| `src/modules/facturacion/verificadores.ts` | VerificaciÃ³n `hmac` genÃ©rica y **MercadoPago** | Se conserva `hmac` como referencia; **MP se retira** |
| `src/modules/facturacion/facturacion.module.ts` | `WebhooksController` (`POST /webhooks/:proveedor`), `BillingService.procesar`, checkout manual | El controlador se reutiliza; se aÃ±ade el proveedor `izipay` |
| `BILLING_HMAC_SECRET`, `BILLING_MP_SECRET` | Secretos de los proveedores provisionales | Se sustituyen por las credenciales de Izipay |

### 2.2.1 Mapeo entre la especificaciÃ³n y nuestro esquema

La especificaciÃ³n propone seis tablas. AsÃ­ encajan (y quÃ© falta) en el modelo actual:

| EspecificaciÃ³n | En nuestro esquema | Estado |
|---|---|---|
| `plans` | `Plan` + `PlanFeature` | âœ… Existe y se reutiliza tal cual |
| `subscriptions` | `Subscription` | âš ï¸ Existe pero **le faltan** `providerSubscriptionId`, `paymentMethodId`, `effectDate`, `rrule`, `nextPaymentAt` |
| `payments` | `CobroSuscripcion` | âš ï¸ Existe con `claveIdempotencia` y `referenciaExterna`; **falta** separar `providerStatus` de `internalStatus` y el `orderId` |
| `payment_events` | `WebhookEvent` + `EventoIzipay` | âœ… `eventId` Ãºnico con duplicados detectados; `EventoIzipay` conserva el `rawAnswer` firmado con `firmaValida` y su `estado` (`procesado`, `sin_cobro`, `importe_moneda_incorrectos`, `orden_desconocida`) |
| `payment_methods` | â€” | âŒ **No existe.** Es imprescindible para la etapa 2 (tokenizaciÃ³n): lo que se guarda es el token, nunca el PAN ni el CVV |
| `customers` | `Tenant` (para el SaaS) | âœ… No hace falta tabla nueva: el comprador sale de `TenantConfig` |
| `orders` | `IntentoIzipay` â†’ `CobroSuscripcion` | âœ… Correlaciona `orderId` â†” intento â†” cobro. Por decisiÃ³n de producto NO referencia `Pago`: un intento abandonado o rechazado nunca ensucia el arqueo de clÃ­nica |

**Consecuencias de diseÃ±o que esto implica:**

1. **Un intento de pago no es un pago.** Un formToken puede quedar abandonado o
   rechazado sin que exista un `Pago`. Meter los intentos en `Pago` ensuciarÃ­a el
   arqueo de caja del mÃ³dulo de clÃ­nica (que hoy cuadra) y obligarÃ­a a filtrar
   estados del gateway en todos los reportes.
2. **Estados separados.** La propuesta de `provider_status` + `internal_status` es
   correcta y evita acoplar el negocio a los nombres de Izipay (`CAPTURED` â†’
   nuestro `PAID`).
3. **Idempotencia ya resuelta en parte.** `WebhookEvent.eventId` Ãºnico y
   `CobroSuscripcion.claveIdempotencia` Ãºnica cubren lo que la especificaciÃ³n pide
   (`provider + external_transaction_id + event_type`); solo hay que **construir la
   clave con esos tres campos** y reutilizar la recuperaciÃ³n ante `P2002` que ya
   estÃ¡ implementada.
4. **`signature_valid` es un hueco real de auditorÃ­a** de la integraciÃ³n: sin esa
   columna no se puede distinguir un evento verificado de uno que llegÃ³ con firma
   invÃ¡lida (que hoy simplemente se rechaza con 401 y no se registra).

### 2.3 Etapa 1 â€” Cobro del plan (implementada)

**Objetivo cumplido:** cobrar el periodo de la suscripciÃ³n con tarjeta
mediante formulario incrustado, conciliado por IPN contra `CobroSuscripcion`.

Lo construido (ver [izipay-suscripcion.md](izipay-suscripcion.md)):

1. **Motor en `core/pasarela/`** que no sabe quÃ© cobra (`crearFormToken`,
   `verificarFirma` sobre el `kr-answer` crudo, cÃ©ntimos con `Decimal`,
   configuraciÃ³n con las 5 variables).
2. **`IntentoIzipay` apunta al cobro**, con `orderId` Ãºnico, importe en
   cÃ©ntimos y metadata de conciliaciÃ³n. Sin relaciÃ³n con `Pago`.
3. **`POST /api/facturacion/mi-plan/formtoken`** (`billing.manage`): usa el
   cobro pendiente o genera el del periodo; el importe sale del servidor.
4. **IPN por `BillingService.procesar`** en una sola transacciÃ³n con el evento:
   cobro pagado + periodo extendido, una sola vez aunque el aviso se repita.
5. **Pantalla Â«Mi planÂ»** (`/mi-plan`): plan, periodo, cobro pendiente,
   Â«Pagar el planÂ» y pÃ¡gina de resultado que solo consulta el estado.

Puntos que antes estaban por decidir y ya estÃ¡n cerrados:

1. ~~DÃ³nde encaja en el dominio~~ â†’ En `CobroSuscripcion`, nunca en `Pago`.
2. ~~QuiÃ©n genera el `orderId`~~ â†’ El backend (UUID por intento), guardado para
   casar el IPN.
3. **El importe nunca se confÃ­a al retorno del navegador** (sigue vigente).
4. **El `formToken` exige llamada servidor a servidor** (sigue vigente).

### 2.4 Etapa 2 â€” Suscripciones (la MISMA documentaciÃ³n)

**Objetivo:** cobrar la suscripciÃ³n de la clÃ­nica sin intervenciÃ³n manual,
reutilizando `Subscription`, `EntitlementsService` y el dunning ya existentes.

**El flujo de pago es el mismo `CreatePayment` de la etapa 1** (formToken â†’
formulario incrustado â†’ validaciÃ³n â†’ IPN). Lo que cambia es **la periodicidad**
â€”hay que poder cobrar sin que el usuario estÃ© presenteâ€” y, por tanto, **el
guardado del medio de pago**. No es una integraciÃ³n nueva: es la misma con un
job delante.

Puntos a resolver:

1. **TokenizaciÃ³n de la tarjeta.** El cobro recurrente sin intervenciÃ³n exige un
   token/cryptograma guardado. Eso convierte a `CobroSuscripcion.metadata` (o a una
   tabla nueva) en un dato **sensible**: hay que cifrarlo en reposo y tratarlo como
   secreto, igual que ya se hace con el refresh token de Google
   (AES-256-GCM, `GOOGLE_TOKEN_KEY`).
2. **ProgramaciÃ³n del cobro.** Requiere un job (Redis + cola, o un cron con lock)
   que aÃºn no existe: hoy no hay ningÃºn proceso en segundo plano en el proyecto.
   Es el mismo trabajo pendiente que el marcado de cuotas vencidas.
3. **Reintentos y dunning.** Cuando el cobro recurrente falla, `PAST_DUE` â†’
   `SUSPENDED` ya estÃ¡ implementado; hay que decidir la polÃ­tica de reintentos
   (cuÃ¡ntos, con quÃ© separaciÃ³n) antes de degradar.
4. **Idempotencia del cobro recurrente.** La clave debe incluir el periodo
   (`chk-<tenant>-<plan>-<YYYYMM>` ya es el formato manual): reutilizarla evita
   cobrar dos veces el mismo mes si el job se ejecuta dos veces.

### 2.5 Etapa 3 â€” MigraciÃ³n a web-core embebido

**Objetivo:** sustituir el cliente de pago (`micuentaweb` REST V4.0) por el
producto nuevo **web-core**, que tambiÃ©n incrusta un formulario en la pÃ¡gina, sin
cambiar el modelo de datos ni la conciliaciÃ³n. **No es Â«pasar de redirecciÃ³n a
embebidoÂ»**: la etapa 1 ya es embebida. Lo que cambia es **el SDK y el esquema de
firma** (ver 2.7).

Lo que ya sabemos de la documentaciÃ³n de web-core (modalidad *embebido*):

- La configuraciÃ³n es un objeto `iziConfig` con `action`, `merchantCode`,
  `transactionId`, `order` (`orderNumber`, `currency`, `amount`, `processType`,
  `merchantBuyerId`, `dateTimeTransaction`), `billing`, `shipping` y
  `render: { typeForm: 'embedded', container, showButtonProcessForm }`.
- Se instancia `new Izipay({ config })` y se muestra con
  `checkout.LoadForm({ authorization, keyRSA, callbackResponse })`, donde
  `authorization` es el **token de sesiÃ³n** que emite el backend y `keyRSA` la
  clave pÃºblica.
- El script del SDK se carga con
  `.../payments/v1/js/index.js?mode=embedded&container=<id>`, y el `container`
  debe existir en el DOM o el formulario no se muestra.

**ImplicaciÃ³n de arquitectura:** el `authorization` y el `keyRSA` salen de una
llamada servidor a servidor. Eso significa que el frontend necesita un endpoint
propio (Â«preparar pagoÂ») que devuelva esos valores y **nunca** las credenciales
del comercio. Si en la etapa 1 ya se implementa ese endpoint, la etapa 3 es
prÃ¡cticamente cambiar el script del SDK y el `typeForm`.

### 2.6 Lo que queda por confirmar (con Izipay, no en la documentaciÃ³n)

Tras leer la especificaciÃ³n adjunta ya no hay dudas de flujo, endpoints ni
payloads. Lo que **no** depende de la documentaciÃ³n, sino del contrato del
comercio, y hay que confirmar **con Izipay antes de prometer la funciÃ³n**:

1. Que la **funcionalidad de recurrencia estÃ¡ habilitada** para el comercio/MID.
2. QuÃ© **mÃ©todos de pago** pueden usarse para recurrencia en ese MID.
3. QuÃ© **endpoints REST V4 estÃ¡n habilitados** para la cuenta.
4. Los **parÃ¡metros exactos** que exige la versiÃ³n actual de la API: los de la
   especificaciÃ³n son conceptuales.
5. Las **reglas de `effectDate`** aplicables (ver 2.1.2).
6. QuÃ© **eventos IPN estÃ¡n habilitados**.
7. El **mecanismo de autenticaciÃ³n y firma** de cada operaciÃ³n.
8. Las **condiciones comerciales y regulatorias** del cobro recurrente.

Quedan dos huecos que ni la documentaciÃ³n accesible ni la especificaciÃ³n fijan:

- la **forma exacta del IPN** y con quÃ© se comprueba su autenticidad;
- cÃ³mo se pide una **devoluciÃ³n** (fuera de alcance: usa otra documentaciÃ³n).

> Para el protocolo clÃ¡sico de campos `vads_` la especificaciÃ³n recuerda el
> procedimiento (ordenar alfabÃ©ticamente, UTF-8, concatenar con `+`, aÃ±adir la
> clave, HMAC-SHA-256; SHA-1 es legado), pero **ese no es el camino de REST V4**:
> ahÃ­ manda `kr-answer`/`kr-hash` (etapas 1-2) y `payloadHttp`/`signature`
> (etapa 3), como se detalla en 2.7.

### 2.7 VerificaciÃ³n de firma: son DOS esquemas distintos

Es el punto donde es mÃ¡s fÃ¡cil equivocarse, porque los dos productos firman cosas
diferentes. **No reutilizar el verificador de uno para el otro.**

**Etapas 1 y 2 â€” `micuentaweb` REST V4.0 (formulario incrustado):**

- El frontend envÃ­a a nuestro backend `kr-answer` (la respuesta cruda del pago) y
  `kr-hash` (su firma).
- El backend **recalcula el hash de `kr-answer` con la clave secreta** y lo compara
  con `kr-hash`. Si coincide, la respuesta es Ã­ntegra; si no, se descarta y no se
  muestra ningÃºn resultado al paciente.
- ComparaciÃ³n en **tiempo constante** (`crypto.timingSafeEqual`).
- **El algoritmo exacto y quÃ© clave se usa hay que confirmarlos** en
  [Analizar el resultado del pago](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/kb/payment_done.html)
  (ver 2.6): aquÃ­ no se dan por supuestos.

**Etapa 3 â€” `web-core`:**

- La respuesta y el IPN traen el payload original en `payloadHttp` y su firma en
  `signature`.
- La verificaciÃ³n es `HMAC-SHA256(clave = claveHash, mensaje = payloadHttp)`
  **codificado en base64**, comparado con `signature`.
- **No hay que re-serializar el cuerpo**: se firma sobre `payloadHttp` tal cual.
- Solo se valida cuando `code` **no** es `021` ni `COMMUNICATION_ERROR`.
- El ejemplo de la documentaciÃ³n compara con `===`; aquÃ­ se harÃ¡ en tiempo constante.

**En ambos casos la firma autentica, pero no basta.** Una firma vÃ¡lida prueba que
el mensaje lo emitiÃ³ Izipay; **no** prueba que corresponda al cobro que esperamos.
Falta conciliar contra nuestro registro:

1. El identificador de pedido debe existir y estar **pendiente** en nuestro sistema
   (por eso lo generamos nosotros).
2. El **importe y la moneda** deben coincidir con lo esperado. Sin esto, un pago de
   S/ 1 confirmarÃ­a una suscripciÃ³n de S/ 249.
3. Registrar siempre el evento en `WebhookEvent` con un `eventId` derivado del
   identificador de la transacciÃ³n, y responder `2xx` **solo** tras procesarlo, para
   que el gateway no reintente en bucle por un error nuestro.
4. **El IPN manda.** Si el retorno del navegador dice Â«pagadoÂ» y el IPN no llega o
   dice lo contrario, prevalece el IPN.

### 2.8 Riesgos conocidos del cÃ³digo actual que se retiran con Izipay

- **`metadata.referencia` no va firmado en el verificador de MercadoPago.**
  MP firma un manifiesto construido con `id`, `request-id` y `ts`; el campo
  `metadata.referencia`, que decide **a quÃ© cobro** se atribuye el pago, queda
  fuera de la firma. Con una firma vÃ¡lida de un pago propio se podrÃ­a alterar esa
  referencia y extender la suscripciÃ³n de **otra clÃ­nica**.
  **Mientras MP no se active, no es explotable.** Si alguna vez se habilita antes
  de Izipay, hay que corregirlo primero: resolver el cobro por
  `CobroSuscripcion.referenciaExterna` (que es Ãºnica) usando el id **firmado**,
  en lugar de confiar en el cuerpo.
- **El proveedor `hmac` genÃ©rico** firma una canonicalizaciÃ³n del JSON
  (`canonico()`), no el cuerpo crudo. Sirve para pruebas y para un gateway que se
  conecte con ese contrato, pero **no** es el esquema de Izipay.

### 2.9 Checklist por etapa

**Etapa 1 (pagos Ãºnicos, formulario incrustado)**
- [ ] Confirmar en la documentaciÃ³n (en el navegador: son SPA) el endpoint, la autenticaciÃ³n y el cuerpo de `CreatePayment`, y el algoritmo de `kr-hash`.
- [ ] Credenciales por entorno: `IZIPAY_USERNAME`, `IZIPAY_PASSWORD`, `IZIPAY_PUBLIC_KEY`, `IZIPAY_HMAC_SHA256_KEY`, `IZIPAY_ENV` â€” nunca en el repositorio.
- [ ] Cliente de Izipay encapsulado (`services/izipay/â€¦`), sin llamadas sueltas repartidas por el cÃ³digo.
- [ ] `POST /api/payments/form-token`: convierte el importe a **unidades mÃ­nimas** (`amount * 100`), arma `customer.billingDetails` y llama a `Charge/CreatePayment` con `Authorization: Basic`; devuelve **solo** `formToken` + `publicKey`.
- [ ] Tabla de **intentos/Ã³rdenes** (`orders`): un formToken abandonado o rechazado **no** debe crear un `Pago` ni ensuciar el arqueo de caja.
- [ ] `POST /api/payments/validate`: valida `kr-hash` sobre `kr-answer` en tiempo constante, analiza el estado y compara con la orden (importe, moneda, `orderId`); responde al frontend **sin** cambiar el estado por sÃ­ solo.
- [ ] `POST /api/payments/ipn`: **fuera** de la autenticaciÃ³n normal; valida firma â†’ identifica la orden â†’ valida importe, moneda y estado â†’ registra el evento â†’ actualiza la orden.
- [ ] Idempotencia del IPN con la clave `provider + external_transaction_id + event_type`, reutilizando la recuperaciÃ³n ante `P2002` que ya existe.
- [ ] AÃ±adir **`signature_valid`** a `WebhookEvent` (hueco de auditorÃ­a: hoy no se persiste si la firma era vÃ¡lida).
- [ ] Frontend: `@lyracom/embedded-form-glue` (`loadLibrary` â†’ `setFormConfig` â†’ `attachForm`/`showForm`) sobre `<div id="micuentawebstd_rest_wrapper"><div class="kr-embedded"></div></div>`, mÃ¡s los CSS/JS de Krypton.
- [ ] **`orderId` propio por tenant** con `SecuenciasService`, enviado al crear el formToken.
- [ ] Rate limiting en los tres endpoints: hoy el limitador solo cubre el login.
- [ ] Nunca registrar PAN/CVV ni devolver credenciales; logs con `traceId`, `orderId`, `providerStatus`, `internalStatus`, importe y moneda.
- [ ] Pruebas con [tarjetas de prueba](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/kb/test_cards.html): aprobado, rechazado, abandono, `formToken` invÃ¡lido, firma invÃ¡lida, IPN repetida, **IPN tardÃ­a**, orden inexistente, importe incorrecto, moneda incorrecta.

**Etapa 2 (suscripciones)**
- [ ] Confirmar con Izipay que la recurrencia estÃ¡ habilitada (ver 2.6) **antes** de empezar.
- [ ] Tabla **`payment_methods`**: `provider_token`, `brand`, `last4`, `expiry_*`; **nunca** PAN ni CVV.
- [ ] Token cifrado en reposo (mismo patrÃ³n que `GoogleAccount.refreshToken`, AES-256-GCM).
- [ ] Ampliar `Subscription` con `providerSubscriptionId`, `paymentMethodId`, `effectDate`, `rrule`, `nextPaymentAt`.
- [ ] `POST /api/subscriptions`: el precio sale del **plan almacenado**; `RRULE` construida desde `interval`/`intervalCount`; `effectDate` con zona horaria correcta y sin duplicar el primer cobro.
- [ ] `POST /api/subscriptions/:id/cancel`: localiza `providerSubscriptionId` y verifica **propiedad** antes de llamar a `Subscription/Cancel`.
- [ ] IPN de suscripciÃ³n: distinguir creaciÃ³n, renovaciÃ³n exitosa, renovaciÃ³n rechazada, reintento y cancelaciÃ³n.
- [ ] Job periÃ³dico con lock (no existe todavÃ­a ningÃºn proceso en segundo plano) y polÃ­tica de reintentos antes de degradar a `PAST_DUE`/`SUSPENDED`.
- [ ] Separar `providerStatus` de `internalStatus` en los cobros.
- [ ] Pruebas: token creado/invÃ¡lido/expirado, suscripciÃ³n creada/rechazada, primera renovaciÃ³n, renovaciÃ³n exitosa y rechazada, reintento, cancelaciÃ³n, IPN duplicada y **fuera de orden**.

**Etapa 3 (web-core embebido)**
- [ ] Adaptar `POST /formtoken` para que devuelva lo que el SDK nuevo necesita (`authorization` = token de sesiÃ³n, `keyRSA`): el patrÃ³n Â«el backend genera el token, el frontend lo incrustaÂ» se mantiene.
- [ ] Cambiar el esquema de firma a `payloadHttp` + `signature` (base64) â€” **no reutilizar** el verificador de `kr-answer`/`kr-hash`.
- [ ] `container` en el DOM y coherencia entre el `mode` del script y el `typeForm`.
- [ ] Retirar el cliente de `micuentaweb` una vez verificado el nuevo, no antes.

---

## 3. Otras deudas registradas (no integraciones)

| # | Deuda | Motivo por el que se aplaza | Disparador |
|---|---|---|---|
| 1 | **AuditorÃ­a de rechazos de guard.** Los guards de Nest corren **antes** que los interceptores, asÃ­ que un 401 de `JwtAuthGuard` o un 403 de `TenantGuard`/`PermissionsGuard` no se registran en `Auditoria`. El login fallido (401 del servicio) **sÃ­** se registra | ExigirÃ­a registrar desde cada guard; el valor de negocio es bajo frente a la superficie que abre | Primer incidente de seguridad que requiera el rastro, o auditorÃ­a formal |
| 2 | **RLS en PostgreSQL** (ADR-006) | El aislamiento ya estÃ¡ probado a nivel de aplicaciÃ³n (33 tests). RLS con `service_role` es una segunda capa que exige rol dedicado y pruebas propias | Etapa 2 de crecimiento, cuando haya varias instancias |
| 3 | **Redis y colas** | Hoy no hace falta: hay un solo VPS y no existe ningÃºn proceso en segundo plano | Etapa 2: se necesita para el cobro recurrente y para marcar cuotas vencidas |
| 4 | **`EstadoCuota.vencida` nunca se asigna** | Requiere el job del punto 3 | Junto con Redis y colas |
| 5 | **Secuencias: reciclado del cÃ³digo mÃ¡s alto.** La numeraciÃ³n usa el mÃ¡ximo numÃ©rico del periodo; borrar el cÃ³digo **mÃ¡s alto** reutiliza ese nÃºmero | Exige una tabla de contadores con migraciÃ³n; el caso solo se da al borrar el Ãºltimo recibo | Volumen alto de comprobantes, o exigencia de correlatividad estricta |
| 6 | **`descarga` de documentos carga el archivo en memoria** | Es necesario para validar la firma antes de entregar el primer byte; el tope declarado es 20 MB | Documentos grandes (vÃ­deos, series de RX completas) |
| 7 | **La subida exige `multipart` con todo el archivo en memoria** (`memoryStorage`) y no admite subidas reanudables | El tope es 20 MB y el archivo se valida por firma antes de escribir: trocearlo complicarÃ­a esa validaciÃ³n | Archivos muy grandes, o subida desde redes inestables |
| 8 | **AuditorÃ­a: la imagen previa no cubre todo.** `datosAnteriores` se captura leyendo la fila por el `:id` de la ruta, asÃ­ que quedan sin imagen las mutaciones cuyo parÃ¡metro se llama distinto (`PATCH /api/subscriptions/:tenantId`) y los modelos sin `tenantId` (`User`, `WebhookEvent`) | Cubrirlos exige un mapeo por ruta y parÃ¡metro, y un criterio de pertenencia para modelos que no tienen `tenantId` | Necesidad de reconstruir el estado anterior de una suscripciÃ³n o de un usuario |
| 9 | **La comprobaciÃ³n de secretos en la auditorÃ­a mira NOMBRES de clave, no valores.** `redactar` conserva la clave con `[REDACTADO]`, asÃ­ que una aserciÃ³n que busque el nombre de una columna sensible (p. ej. `datosSnapshot`) da falso positivo | Es una imprecisiÃ³n de la prueba existente, no un fallo de redacciÃ³n; cambiarla obliga a decidir si se prefiere omitir la clave o enmascararla | Cuando se auditen modelos clÃ­nicos con columnas sensibles (consentimientos) |
| 10 | **`TenantConfig.ciudad` tiene `@default("Huancayo")` en el esquema.** El alta ya acepta `ciudad`, pero si el panel no la envÃ­a, la clÃ­nica nace en Huancayo â€”la ciudad de la primera clÃ­nica, incrustada en el esquemaâ€” y esa ciudad sale impresa en los documentos | Quitar el valor por defecto exige una migraciÃ³n y decidir si la columna pasa a ser obligatoria; hoy el `select` del alta lo mitiga | Al dar de alta la primera clÃ­nica de otra ciudad, o al imprimir documentos de una clÃ­nica sin ciudad |
| 11 | **El rollback de la transacciÃ³n de alta no estÃ¡ cubierto por una prueba.** `POST /platform/tenants` es un Ãºnico `$transaction`, asÃ­ que Prisma garantiza la atomicidad, pero nada lo comprueba: forzar un fallo a mitad exigirÃ­a un doble de Prisma o una carrera determinista | No es comprobable con e2e sin mocks, y la garantÃ­a la da el propio `$transaction` | Si el alta crece con mÃ¡s pasos (p. ej. logo, plantillas) y alguien introduce una escritura FUERA de la transacciÃ³n |
| 12 | **El detalle de un pago no cuadra con el total si se edita el monto.** El formulario envÃ­a la lÃ­nea de detalle con el **precio de lista** del tratamiento y, por separado, el `montoTotal` que el usuario puede editar (descuento). El backend guarda ambos sin comprobar que sumen: el recibo puede mostrar una lÃ­nea de S/ 120 con un total de S/ 100 | Decidir si la lÃ­nea refleja lo que se cobrÃ³ o si hace falta un campo de descuento; ninguna de las dos opciones es Â«la correctaÂ» sin criterio de negocio | Al emitir el primer recibo con descuento |
| 13 | **Los documentos subidos vivÃ­an sin respaldo en disco local.** `StorageService` guarda en `uploads/` y `db:backup` solo vuelca la base | Respaldo local (`archivos:backup`, simulacro en CI) y, en despliegue, `compose.staging.yml` monta `uploads/` en volumen nombrado (los redespliegues ya no borran): sigue pendiente el almacenamiento de objetos como opciÃ³n estratÃ©gica (copias y PITR del proveedor) | Al montar el servidor de producciÃ³n (hay que copiar `uploads/` con el plan de copias del servidor) |
| 14 | **Las copias viven en la misma mÃ¡quina que protegen.** `BACKUP_DIR` local o volumen del compose: cubre borrados y corrupciÃ³n, no la pÃ©rdida del servidor | Existe el mecanismo (`db:backup-remoto` con verificaciÃ³n sha256, simulacro de cadena en CI, timer 04:00 y vigilancia de antigÃ¼edad; ver `backups.md` Â§9): queda contratar/configurar el destino de producciÃ³n (`RESPALDO_REMOTO`, `rclone config` si aplica) y probar la restauraciÃ³n desde Ã©l | Al contratar el servidor de producciÃ³n |
| 15 | **Sin canal real de alertas.** Los timers systemd avisan al journal (`OnFailure` + `dental-saas-aviso@.service`) y hay gancho para `/etc/dental-saas/avisos.sh`, pero ningÃºn correo/webhook configurado | Conectar el gancho al canal del equipo (y el timer de vigilancia ya sale != 0 si algo va mal) | Antes del primer despliegue con datos reales |
| 16 | **Secretos en ficheros `.env`, sin gestor.** RotaciÃ³n manual; si un secreto llega a git, hay que rotarlo (revertir no basta) | Gestor de secretos o variables del orquestador cuando haya mÃ¡s de un servidor | Al salir del servidor Ãºnico |
| 17 | **No hay procedimiento de incidentes.** La documentaciÃ³n cubre arquitectura, despliegue, respaldos, pruebas y primeros pasos, pero no **quÃ© hacer cuando algo falla en producciÃ³n**: por dÃ³nde empezar, quÃ© mirar (vigilancia, logs, auditorÃ­a), cÃ³mo restaurar y a quiÃ©n avisar | Se escribe mucho mejor con el servidor delante â€”o tras el primer incidente realâ€” que en abstracto; hoy la vigilancia ya dice quÃ© estÃ¡ mal, pero no quÃ© hacer | Al montar el servidor de producciÃ³n, antes del primer cliente |
> **Resuelto (2026-10-14):** el procedimiento existe: `docs/lanzamiento.md` (puesta en produccion con criterio de hecho por paso) y `docs/incidentes.md` (primeros cinco minutos, diagnostico por sintoma, restauracion y comunicacion). La lista viva de pasos es el runbook.

> **Retirado (2026-10-14): el ubigeo del paciente.** AquÃ­ figuraba la deuda 18 (Â«catÃ¡logo
> de ubigeos vacÃ­oÂ»). Se cierra **retirando la funcionalidad, no cargando datos**:
> `Paciente.ubigeoCodigo` era una columna heredada del DDL del proyecto antiguo, el
> catÃ¡logo nunca se cargÃ³ y **ningÃºn flujo de negocio dependÃ­a de Ã©l** (solo se
> mostraba en la ficha del paciente; ni el consentimiento, ni los informes, ni
> ninguna exportaciÃ³n lo usaban). Como el formulario lo enviaba como texto libre
> contra una clave forÃ¡nea, cualquier cÃ³digo producÃ­a P2003 â†’ Â«Referencia invÃ¡lidaÂ»
> al guardar: el mismo error que ya ocurrÃ­a en el sistema antiguo, donde lo
> resolvÃ­an excluyendo el campo del payload.
>
> Se eliminÃ³ la columna, su clave forÃ¡nea, el mÃ³dulo `ubigeo` y su campo en el formulario
> (migraciÃ³n `8_quitar_ubigeo_paciente`). **La tabla `Ubigeo` se conserva** â€”catÃ¡logo
> oficial del PerÃº, sin filasâ€” por si algÃºn dÃ­a se quiere un selector de
> departamento/provincia/distrito: recuperarlo exigirÃ­a cargar el catÃ¡logo y volver a
> aÃ±adir la columna y su FK en `Paciente` (una migraciÃ³n nueva).

---

## 4. Deuda por diseÃ±o (no es deuda)

Para que no se confunda con lo anterior:

- **La API es stateless y el rate limiting vive en memoria.** Con varias rÃ©plicas
  el lÃ­mite efectivo se multiplica por el nÃºmero de instancias. EstÃ¡ documentado en
  `src/core/auth/rate-limit.ts` y es correcto para la etapa 1.
- **La extensiÃ³n Prisma no filtra `findUnique`/`update`/`delete` por id.** Es una
  consecuencia asumida de ADR-002; por eso cada servicio verifica la pertenencia y
  devuelve 404. Hay 33 pruebas de aislamiento que lo vigilan.
- **El pooler de Supabase y las migraciones** dependen de la configuraciÃ³n del
  hosting, no del cÃ³digo.
- **`db:migrar-clinica` no se ejecuta en el lanzamiento.** La clÃ­nica actual no
  tiene datos que migrar, asÃ­ que la Fase 4 es alta desde el panel + primer dÃ­a
  guiado. El script queda documentado (`despliegue.md` Â§3) para una clÃ­nica
  futura que sÃ­ traiga datos; que nadie lo espere el dÃ­a del corte.
