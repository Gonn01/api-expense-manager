# Arquitectura — API Node (`api-plataformas-desarrollo`)

Cómo está organizada la API y cómo se agrega un recurso o un endpoint. Es el backend compartido por la web y la app Flutter: **todo cambio de contrato afecta a los dos clientes**.

Stack: Node.js con ESM (`"type": "module"`), Express 5, JavaScript sin TypeScript, PostgreSQL mediante `postgres` (postgres.js) y SQL crudo, JWT, bcrypt, Pusher, vitest.

## 1. Capas

Cada recurso sigue la misma estructura de cuatro archivos más su ruta:

```
routes/<recurso>.routes.js              verbos HTTP → controller
factories/<recurso>.factory.js          DI manual: repository → service → controller
controller/<recurso>.controller.js      adaptador HTTP: lee req, valida forma, responde
services/<recurso>.service.js           reglas de negocio; lanza customError(ErrorCode.X)
repositories/<recurso>.repository.js    SQL crudo con executeQuery (db.js)
```

- No hay contenedor de DI: las factories instancian todo a mano.
- **Controller**: sin lógica de negocio. Toma `userId` de `req.session`, valida la forma del input (`badRequest`) y delega. Todo `catch` termina en `handleError(res, err)`.
- **Service**: único lugar con reglas de negocio. No conoce `req` ni `res`.
- **Repository**: único lugar con SQL. Siempre con parámetros posicionales (`$1, $2…`); nunca concatenar valores.
- **Usuarios**: toda consulta que devuelve filas de `users` (SELECT o `RETURNING`) usa `USER_PUBLIC_COLUMNS` de `repositories/user-columns.js`, nunca `SELECT *`, así todas las respuestas traen los mismos campos (incluido `avatar`). El hash de la contraseña no sale de la API: solo lo leen `AuthRepository.findUserWithPasswordByEmail` y `UserRepository.getPasswordHash`, y sus services nunca lo devuelven.
- Al agregar un recurso, replicar esta estructura en lugar de apartarse de ella.

## 2. Rutas y autenticación

`routes/index.js` se monta en `/api`. `/api/auth/*` y `/api/health` son públicos; el middleware `verifyToken` protege todo lo demás.

Grupos: `/health`, `/auth`, `/user`, `/entidades-financieras`, `/dashboard`, `/gastos`, `/categorias`, `/notificaciones` (con las acciones compartidas en `/notificaciones/pendientes`), `/settlement`.

`GET /api/health` hace un `SELECT 1` contra la base y responde 200 con `{ status, database, uptime, timestamp }`, o 503 si la base no responde. Sirve para comprobar que la API está levantada.

`verifyToken` valida `Authorization: Bearer <jwt>` con `JWT_SECRET`, compara `tokenVersion` con `users.token_version` y deja el payload en `req.session` (al menos `userId`). Cambiar o descartar la contraseña y `POST /user/sessions/revoke` incrementan esa versión. Antes de validar credenciales, reenviar la verificación o pedir la recuperación, `AuthRateLimitService` consume contadores atómicos de `auth_rate_limits` con las reglas de `utils/auth-rate-limits.js` y responde 429 `DEMASIADOS_INTENTOS` al superarlos. Responde **401** si falta el token, es inválido o venció: es la señal con la que los clientes cierran la sesión. El **403** queda para un usuario autenticado sin permiso sobre el recurso (`NO_AUTORIZADO`); no devolver 401 por eso, porque deslogearía al usuario.

**Identidad de la cuenta**: hay una sola cuenta por email normalizado (`utils/normalize-email.js`; índice único sobre `lower(email)`, creado por `migrations/manual/2026-11-22_users_identidad_unica.sql`). `POST /auth/firebase-login` recibe `{ idToken, password?, discardPassword? }`; `utils/firebase-token.js` verifica el token con `firebase-admin` contra `FIREBASE_PROJECT_ID`, y de ahí salen uid, email, nombre y foto. `AuthService.#resolveGoogleAccount` busca por uid, después por email, y si no encuentra crea la cuenta. Vincular una cuenta con contraseña exige `password` o `discardPassword: true` (`VINCULACION_REQUIERE_CONTRASENA`, `CONTRASENA_INCORRECTA`). El registro nunca modifica una cuenta existente.

**Email y contraseña con Firebase**: `FirebaseIdentity` (`utils/firebase-identity.js`, una sola instancia creada por `factories/firebase-identity.factory.js` e inyectada en `AuthService` y `UserService` como `identity`) habla con Firebase por la API REST de Identity Toolkit (clave `FIREBASE_WEB_API_KEY`) y por Firebase Admin con la cuenta de servicio (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`; `utils/firebase-app.js` inicializa la app con esas credenciales si están). Si las tres están (`identity.isConfigured`), las contraseñas viven en Firebase y no en `users.password`:

- `POST /auth/register` recibe además `language` (`es` o `en`, para el mail), crea la cuenta en Firebase (`signUp`), pide el mail de verificación y guarda en `users` solo `firebase_user_id`. Responde `{ verification_sent }`.
- `POST /auth/login` valida la contraseña con `signInWithPassword`, verifica el ID token y responde 403 `EMAIL_NO_VERIFICADO` si el email no está verificado. Si Firebase rechaza la contraseña y la cuenta todavía tiene el hash bcrypt en la base, `#migrateLegacyPassword` la compara y, si coincide y Firebase no tiene contraseña para esa cuenta, la guarda en Firebase con el email verificado y pone `password = NULL` (`moveToFirebase`). Si Firebase ya tiene una contraseña, el hash viejo no se acepta y se borra.
- `POST /auth/resend-verification` (`{ email, password, language }`) vuelve a validar la contraseña y pide otro mail; responde `{ verification_sent, already_verified }`.
- `POST /auth/forgot-password` (`{ email, language }`) responde siempre `{ sent: true }`. Si la cuenta existe, `ensureRecoverableUser` la crea en Firebase o le agrega una contraseña al azar si solo tenía Google (sin eso Firebase no manda el mail), y el hash viejo se borra.
- `PUT /user/password` valida la actual contra Firebase (o contra el hash si todavía estaba en la base) y guarda la nueva con Firebase Admin (`setPassword`); `GET /user/password-status` considera también la contraseña de Firebase.
- Los errores de Firebase se traducen: credenciales inválidas → `null` (el service responde `CREDENCIALES_INVALIDAS`), `TOO_MANY_ATTEMPTS_TRY_LATER` → `DEMASIADOS_INTENTOS`, `EMAIL_EXISTS` → `EMAIL_YA_REGISTRADO`, contraseña débil → `VALIDATION_ERROR` con `details.field = "password"`. El reenvío y la recuperación sin Firebase responden 503 `AUTH_EMAIL_NO_CONFIGURADO`.

Sin esa configuración (entorno local, tests de integración y e2e) todo sigue con bcrypt y no hay verificación. `GET /user/password-status` responde `{ has_password }` y `PUT /user/password` recibe `{ current_password?, new_password }`.

**Autorización**: el usuario se toma siempre de `req.session.userId`, nunca del body. Todo service que lea o modifique un recurso debe verificar que pertenezca a ese usuario. Para gastos, `GastosService` lo resuelve con `#getOwned(id, userId)` (trae el gasto y verifica que su entidad sea del usuario; `GASTO_NOT_FOUND` / `NO_AUTORIZADO`): toda operación sobre un gasto empieza por ahí, y todo método público del service recibe `userId`. Para validar varios ids en una sola consulta desde otro service (por ejemplo, al marcar gastos en una sesión de cuentas) está `assertOwnedAll(ids, userId)`. Un endpoint nuevo **debe** hacer lo mismo.

## 3. Contrato de respuesta

- Éxito: `{ data: … }`, opcionalmente con `message`.
- Error: `{ error: <mensaje>, code: <CÓDIGO>, details?: … }` con el status HTTP correspondiente.

Los clientes deciden por `code`, nunca por el texto.

## 4. Errores

`utils/errors.js` define:

- `CATALOG`: única fuente de verdad `código → (status HTTP, mensaje por defecto en español)`.
- `ErrorCode`: los códigos como constantes (`ErrorCode.GASTO_NOT_FOUND`). Usarlas siempre, no el string.
- `customError(code, overrides)`: fábrica de errores de dominio. `overrides.message` permite un texto interpolado.
- `badRequest(res, mensaje)`: 400 `VALIDATION_ERROR` para validar input en el controller.
- `handleError(res, err)`: traduce un `CustomError` a su respuesta; cualquier otra cosa es un bug → se registra y sale un 500 genérico.
- `errorMiddleware`: red de seguridad, registrado al final en `index.js`.

Reglas:

- Los services lanzan `customError(ErrorCode.X)`, no `throw new Error("texto")`.
- Un error de dominio nuevo se agrega al `CATALOG`, **y además** al catálogo espejo de cada cliente: `src/utils/error-catalog.js` en la web y el equivalente en la app Flutter.

## 5. Datos

- Sin ORM y sin herramienta de migraciones: el esquema de Postgres se administra fuera del repo. Un cambio de esquema (columna nueva, valor nuevo del enum `movement_type`) se deja como `.sql` en `migrations/manual/<fecha>_<motivo>.sql` y se ejecuta a mano contra la base **antes** de desplegar el código que lo usa. `ensureGastosSchema` (en `gastos.repository.js`) no se llama desde ningún lado.
- Baja lógica: entidades, gastos y categorías llevan `deleted`. Toda consulta de lectura filtra `deleted = false`, salvo el listado `GET /entidades-financieras`, que devuelve activas y eliminadas juntas con el campo `deleted` para que cada cliente las separe.
- Eliminar una entidad (`EntidadesFinancierasService.eliminar`, en una transacción) da de baja también sus gastos con `purchases.deleted_with_entity = true`, después de `cerrarCompartido` por cada uno; desenlaza los espejos (`unlinkMany`), registra `DELETE` en cada gasto y los quita de la sesión abierta. También pone `linked_user_id = NULL` y, si estaba vinculada, registra `UNLINK` en la entidad, así que restaurarla nunca recupera el vínculo. Las entidades eliminadas antes de esta regla se limpian con `migrations/manual/2026-11-22_desvincular_entidades_eliminadas.sql`. Responde la entidad con `deleted_purchase_ids` para que el cliente los desmarque. Restaurar la entidad restaura solo los gastos con `deleted_with_entity = true` que nunca fueron compartidos y registra `RESTORE`. Eliminar o restaurar un gasto suelto deja la marca en `false`, así un gasto eliminado antes no vuelve con la entidad. La columna se crea con `migrations/manual/2026-11-16_purchases_deleted_with_entity.sql`.
- Alias de Mercado Pago: `financial_entities.mercado_pago_alias` (`migrations/manual/2026-11-22_entidades_alias_mercado_pago.sql`). `PUT /entidades-financieras/:id/alias-mercado-pago` recibe `{ alias }`; `null` o vacío lo quita. `normalizeMercadoPagoAlias` (`utils/mercado-pago-alias.js`) exige de 6 a 20 letras, números, puntos o guiones. La API solo guarda el dato: no se conecta con Mercado Pago.
- Las cuotas pagas no se guardan: se cuentan los movimientos `PAYMENT` de `purchases_movements` (y las pendientes, los `PENDING_PAYMENT`). Los tipos históricos (`PAYMENT_REQUESTED`, `PAYMENT_REVERTED`, `REVERSAL_REQUESTED`, `REVERSAL_CANCELLED`, `REVERSAL_REJECTED`, `SHARED_APPROVED`, `SHARED_REJECTED`, `SHARED_RETRIED`) solo son líneas del historial: ninguna consulta de cuotas o saldos los cuenta. `PAYMENT_RECEIVED` no existe en el enum de la base: `getReceivedPayments` lo arma al leer el detalle a partir de los `PENDING_PAYMENT` y `PAYMENT_REQUESTED` del gasto hermano registrados por la otra persona, y su `paired_movement_id` apunta al `PAYMENT` de la copia para heredar el número de cuota. `SHARED_SENT` tampoco existe en la base: `getSharedSentEvent` lo arma desde el `CREATION` de la copia, con id negativo para no chocar con esa fila, y `created_by_user_id` es el dueño del original. El detalle oculta las líneas `EDITED` antiguas "Compartido con X", que esa línea reemplaza.
- Historial de pagos: `closePendingPayment` (y `confirmPendingPayment`, que lo usa) resuelve el pendiente en una sola consulta: la fila original conserva su `id`, cambia de tipo y toma `created_at = NOW()`, y se inserta una copia `PAYMENT_REQUESTED` con la fecha y el usuario originales y `paired_movement_id` apuntando a esa fila. La fila original sigue siendo la del estado porque los snapshots y el pago espejo apuntan a su `id`. `logPaymentEvent` registra los pasos de una reversión en cada pago del par, con quien actuó en `created_by_user_id`. Ningún movimiento se borra: `revertPaymentsByIds` cambia el pago a `PAYMENT_REVERTED` conservando su `id`, y `SettlementService` deriva `revertido` de ese tipo (o de que la fila no exista, en pagos revertidos antes de esta regla). Aprobar, rechazar y reenviar un gasto compartido registran `SHARED_*` en el original y en la copia. Esquema y reconstrucción parcial de pagos ya confirmados: `migrations/manual/2026-11-21_historial_movimientos_1_enum.sql` y `_2_backfill.sql`, en ese orden.
- Pagos compartidos: el pago se registra en el gasto de quien paga como `PENDING_PAYMENT` (`created_by_user_id` = quien pagó). Al confirmarse pasa a `PAYMENT` y se inserta otro `PAYMENT` en la copia de la contraparte; los dos se apuntan con `paired_movement_id`. Rechazarlo o retirarlo no lo borra: pasa a `PAYMENT_REJECTED` o `PAYMENT_WITHDRAWN`. Para pagar, `getSharedSibling`/`getSharedSiblings` se llaman con `{ includePendingApproval: true }`, así un gasto cuya copia todavía no se aprobó también genera un pendiente (sin notificar; `sibling_status` dice el estado de la copia); el resto de los usos solo ve copias `ACTIVE`. `getPagosCompartidos` le muestra a la contraparte solo los pendientes de copias `ACTIVE`, y `CompartidosService.rechazar` pasa a `PAYMENT_REJECTED` los pendientes del original. Las cuotas pagas al crear un gasto en una entidad vinculada también se guardan como `PENDING_PAYMENT`. Una solicitud de reversión se guarda en `reversal_requested_by_user_id` / `reversal_requested_at` de los dos pagos vinculados; aceptarla los pasa a `PAYMENT_REVERTED` y deja un `REFUND` en cada gasto. `getPagosCompartidos` devuelve en cada pago `sibling_purchase_id`, la copia del otro lado (para quien confirma, su propio gasto), con la que los clientes saben si está marcada en la sesión, y `quota_number`, la cuota que cubre ese pago: las cuotas pagas del gasto más su posición entre los pagos pendientes del mismo gasto (por `created_at`, `id`), así varios pendientes muestran cuotas distintas. Toda esta lógica vive en `PagosCompartidosService` (`services/pagos-compartidos.service.js`), que usan `CompartidosService` (confirmar, rechazar, retirar, responder y cancelar reversiones), `GastosService` (pago directo, cierre de la sesión, `revertirPago`, baja de un gasto compartido) y, a través de este, `SettlementService`. Las factories de esos tres recursos lo construyen y lo inyectan.
- Gastos compartidos rechazados: `CompartidosService.reintentar` y `descartar` bloquean el original y la copia y verifican que sigan rechazados (`#rechazadoDelEmisor`). Reintentar exige que la entidad siga vinculada al receptor (`GASTO_COMPARTIDO_DESVINCULADO`). `POST /notificaciones/pendientes/:id/descartar` recibe `delete_linked` (booleano, obligatorio si hay un espejo activo): da de baja el original, rompe el enlace y, si se pidió, da de baja el espejo y lo quita de la sesión abierta. La copia no se borra: deja de listarse porque su original está eliminado, y ninguno de los dos se puede restaurar. `getCompartidosEmitidos` devuelve `can_retry`, `mirror_id`, `mirror_entity_name` y `mirror_payed_quotas`. Un gasto `REJECTED` no admite pagos ni marcas (`GASTO_NO_ACTIVO`, regla `#sinAceptar` de `GastosService`). Uno `PENDING_APPROVAL` sí: el pago queda `PENDING_PAYMENT` (ver «Pagos compartidos»). Los dos bloquean su estructura en `computeEditLocks`; su espejo nace `ACTIVE` y no sigue esos estados.
- Baja y alta de un compartido: `PagosCompartidosService.cerrarCompartido` corre antes de dar de baja un gasto (también al eliminar su espejo o su entidad). Con la otra copia `ACTIVE`, confirma los pendientes de la contraparte, retira los propios y cancela reversiones y edición pendientes; con la copia sin aceptar, la da de baja. Siempre avisa con `compartido.desvinculado`. `gastosRepository.getSharedState` devuelve `was_shared` (tiene `shared_from_id` o alguna copia, aunque esté eliminada) y la otra parte. Un gasto con `was_shared` no se restaura (`GASTO_COMPARTIDO_NO_RESTAURABLE`) ni se vuelve a compartir. `getDeletedByEntidad` devuelve `can_restore`, y `#detalle` devuelve `was_shared`, `shared_partner_name`, `can_share` y `share_target_name`. `POST /gastos/:id/compartir` (`GastosService.compartir`) crea la copia pendiente, duplica los `PAYMENT` con `paired_movement_id` en los dos sentidos, deja el original `PENDING_APPROVAL`, lo quita de la sesión abierta y emite `compartido.nuevo`; si no cumple las condiciones responde `GASTO_NO_COMPARTIBLE`.
- Ediciones compartidas: `EdicionesCompartidasService` guarda en `purchase_edit_requests` el pedido de cambiar nombre, monto, moneda, tipo, frecuencia o cuotas de un gasto compartido activo, con un índice único que permite una sola solicitud pendiente por par. Pedir y aprobar validan los bloqueos de los dos gastos con `computeEditLocks(gasto, { ignoreShared: true })` (`utils/gasto-edit-locks.js`). La copia de un gasto compartido siempre tiene el tipo opuesto (`oppositeExpenseType`, `utils/enums.js`): `changes.type` se guarda desde el lado de quien pide y `cambiosParaContraparte` lo invierte para la copia, el historial y la tarjeta de quien aprueba. Aprobar actualiza los dos gastos y no toca el espejo. `#detalle` devuelve `shared_edit_locks` (null si no se puede pedir) y `pending_edit_request`. Rutas: `POST /notificaciones/pendientes/gastos/:id/edicion` y `POST /notificaciones/pendientes/ediciones/:editId/{aprobar,rechazar,cancelar}`. Esquema: `migrations/manual/2026-11-21_ediciones_compartidas_1_enum.sql` y `_2_tabla.sql`, en ese orden y antes de desplegar.
- Snapshots: cada ítem guarda `movement_id`, `shared`, `payment_role` (`pago` o `confirmacion`) y `counterparty_name`. `SettlementService.getSnapshot` (y `finishSession`) agrega `payment_status` a cada ítem y `totals.confirmed` leyendo esos movimientos al momento; `listSnapshots` devuelve `pending_count`.
- Edición de gastos (`PUT /gastos/:id`): el controller pasa los campos como un objeto y `GastosService.update` los valida y completa con los valores actuales los que no vienen (`undefined` = no tocar). Los campos bloqueados salen de `#computeEditLocks(gasto, contexto)` (`{ campo: motivo }`; reglas en RF-GAS-15), con el contexto (copia compartida, marcado en la sesión de cuentas) que trae `#editLockContext`: un cambio en uno de ellos es 409 `GASTO_CAMPO_NO_EDITABLE` con `details.field`, y el mismo valor se acepta. `getById` devuelve esos bloqueos en `edit_locks` para que los clientes deshabiliten los campos: una regla de edición nueva va en `#computeEditLocks`, no en los clientes. `update` responde con el mismo detalle que `getById` (con `movements`, `categories` y `edit_locks`), así los clientes no vuelven a pedir el gasto después de editar (lo mismo hace `POST /gastos/:id/settle-quota`, en los dos caminos: pago directo y marcado en la sesión); ese detalle lo arma `#detalle(id, userId, known)`, que recibe lo que el llamador ya leyó (`siblings`, `session`, `marked`) para no repetir consultas; las lecturas independientes van en `Promise.all` y las categorías solo se reescriben si cambiaron, porque cada consulta en serie es un viaje a la base remota. Los pagos nunca se editan acá (`payed_quotas` está siempre bloqueado). Mover de entidad tiene su propio error, `GASTO_ENTIDAD_NO_EDITABLE`.
- Monto y cuotas: `crearGasto` y `update` validan con `parseAmount` y `parseQuotas` (`services/gastos.service.js`) antes de escribir. El monto es un número mayor a 0; las cuotas de un gasto no fijo, un entero entre 1 y `MAX_INSTALLMENTS` (360, exportado por el mismo archivo). Si no cumple, responden 400 `VALIDATION_ERROR` con `details.field` (`amount` o `number_of_quotas`). Un gasto fijo admite 0 cuotas o más, porque hay fijos guardados con 0 y los clientes reenvían ese valor al editar; al crearlo sin cuotas se guarda 1. Los clientes tienen su propia constante con el mismo valor (`MAX_INSTALLMENTS` en la web, `GastoForm.maxInstallments` en Flutter): si cambia, se cambia en los tres.
- Moneda: toda entrada pasa por `normalizeCurrency` (`utils/enums.js`), que la convierte a mayúsculas y devuelve `null` si no está en `Currency`. Crear o editar un gasto, pedir una edición compartida y cambiar la moneda preferida o la del sueldo responden 400 `VALIDATION_ERROR` con un código inválido. La lista de `Currency` debe coincidir con el enum `currency` de la base y con los enums de los dos clientes.
- Historial: toda operación relevante registra un movimiento (`movementsRepository.createGastoLog` / `createEntidadLog`) con un tipo de `MovementType` (`utils/enums.js`). El historial de entidades es *best-effort*: si falla, se registra en el log y la operación continúa (corre en un savepoint, ver abajo).
- Enums de dominio (`Currency`, `ExpenseType`, `ExpenseStatus`, `MovementType`) en `utils/enums.js`.

### Conexión a la base

`db.js` crea un único cliente postgres.js contra el pooler de Supabase (modo transacción, puerto 6543) con `idle_timeout: 20`, `max_lifetime: 1800` y `prepare: false`. El pooler corta las conexiones inactivas: sin `idle_timeout`, la primera consulta después de un rato sin uso fallaba. No quites estas opciones.

### Transacciones

`db.js` expone tres helpers. La transacción en curso viaja en un `AsyncLocalStorage`, así que `executeQuery` la usa sola: los repositories no reciben nada nuevo por parámetro.

- `withTransaction(fn)`: corre `fn` como una transacción (todo o nada). Si `fn` tira, se hace ROLLBACK y el error se propaga. Anidada dentro de otra, se suma a la de afuera.
- `afterCommit(fn)`: posterga un efecto externo hasta el COMMIT y lo descarta si hay ROLLBACK. Fuera de una transacción corre en el momento. La API corre en Vercel, donde una función puede congelarse al responder, así que la operación espera a sus efectos antes de devolver, con un límite de 5 segundos (`EFFECTS_TIMEOUT_MS`): un efecto colgado no retiene la respuesta, pero puede perderse. Los efectos corren en paralelo y sus errores no se propagan. `triggerCompartidos` lo usa siempre: ningún cliente se entera de un cambio que no se guardó.
- `bestEffort(fn)`: para una escritura que puede fallar sin arrastrar a la operación, como el historial de entidades. Dentro de una transacción corre en un SAVEPOINT, porque en Postgres una consulta fallida aborta la transacción entera aunque el error se atrape en JS. El error se propaga, así que el llamador lo atrapa y lo registra.

Reglas:

- **Toda operación de service con más de una escritura va en una transacción**: `return this.tx(async () => { … })`. Los services reciben `runInTransaction` por constructor (por defecto, `withTransaction`); los tests unitarios pasan `(fn) => fn()`. Una operación de una sola escritura no la necesita.
- Dentro de una transacción las consultas van por una sola conexión. Se pueden lanzar en paralelo con `Promise.all`, salvo `bestEffort`, que se espera sola: lo que corra en paralelo quedaría dentro de su savepoint.
- **Cada consulta es un viaje a la base** (~200 ms desde una máquina local contra Supabase). En las acciones frecuentes conviene ahorrarlos: verificar pertenencia y leer el gasto en una sola consulta (`#getOwnedWithOwner`), mandar en paralelo las escrituras independientes y registrar el historial de la entidad después de la transacción (sin savepoint), como hacen `postergarGasto` y `crearGasto`. `crearGasto` además guarda la postergación en el mismo INSERT, registra la creación y las cuotas pagas en una sola inserción (`createGastoLogs`) y asigna las categorías de un gasto nuevo con `addCategoriasToNewGasto`, que inserta y devuelve las categorías en una consulta (sin el DELETE de `setCategoriasForGasto`, porque un gasto nuevo no tiene ninguna). Devuelve el gasto con sus cuotas pagas reales (`payed_quotas`, fechas de pago y finalización) y, si se creó un espejo en la entidad de pago, ese espejo en `mirror`: los clientes lo insertan en su estado sin recargar.
- **Una operación sobre varios gastos no consulta gasto por gasto.** `PagosCompartidosService.cerrarCompartidos` (baja de una entidad) y `confirmarDesdeCopias` (cierre de la sesión de cuentas) resuelven todo en lote; `cerrarCompartido` delega en `cerrarCompartidos` para que la regla exista una sola vez. Para vincular movimientos en lote, `createGastoLogs` guarda `pairedMovementId` en el INSERT y `setPairedMovements` completa el otro lado.
- Si hay riesgo de que dos pedidos simultáneos procesen lo mismo, la fila se bloquea con `SELECT … FOR UPDATE` dentro de la transacción. Lo hace, por ejemplo, el cierre de la sesión de cuentas (`getOpenSession(userId, { forUpdate: true })`). Las operaciones sobre pagos compartidos bloquean el gasto y su copia con `gastosRepository.lockPurchases(ids)`, que ordena los ids para que dos transacciones no se bloqueen mutuamente, y leen los pagos recién después del bloqueo. `GastosService.settleQuota` hace lo mismo antes de validar las cuotas restantes, para que pedidos simultáneos no registren más pagos que cuotas.
- **Una transición de estado se valida después del bloqueo y se escribe con condición.** Aprobar o rechazar un compartido (`#copiaPendienteBloqueada`, `aprobarGasto`, `updateStatusIfPendingApproval`) y operar una reversión (`#pagoBloqueado`, `setReversalRequest`, `clearReversalRequest`, `revertRequestedPayments`) exigen el estado esperado en el `WHERE`. Si no se actualizó ninguna fila, la operación falla antes de escribir historial o avisar.
- Un método de repository que hace varias consultas también se envuelve en `withTransaction`, como `setCategoriasForGasto`, que hace DELETE + INSERT.

## 6. Tiempo real

`utils/pusher.js` expone `triggerCompartidos(userId, evento, datos)`, que publica en el canal privado `private-notificaciones-<userId>` (`userChannel`) y **nunca** propaga el error: un fallo de Pusher no debe romper la operación de negocio. Dentro de una transacción, el aviso sale recién después del COMMIT (`afterCommit`).

`POST /user/realtime-auth` recibe `{ socket_id, channel_name }` y responde `{ data: { auth } }`. Solo firma el canal del usuario de la sesión; cualquier otro responde `NO_AUTORIZADO`.

A Pusher Channels solo se publican los campos de `utils/realtime-payload.js` (identificadores). Los datos que se describen abajo son los que recibe `triggerCompartidos` para guardar la notificación y armar el push.

Los nombres de los eventos están en el enum `PusherEvent` de `utils/enums.js`; no se escriben como texto suelto. Eventos existentes: `compartido.nuevo`, `compartido.aprobado`, `compartido.rechazado`, `compartido.descartado`, `compartido.desvinculado`, `pago.pendiente`, `pago.confirmado`, `pago.rechazado`, `pago.retirado`, `pago.reversion_solicitada`, `pago.reversion_cancelada`, `pago.reversion_aceptada`, `pago.reversion_rechazada`, `edicion.solicitada`, `edicion.aprobada`, `edicion.rechazada`, `edicion.cancelada`, `entidad.vinculada`, `entidad.desvinculada`, `gasto.postergado`, `gasto.postergacion_quitada`. Los de entidad llevan `{ actorId, actorName, entityId }`, donde `entityId` es la entidad de quien recibe el evento vinculada al actor, o `null`. Los de gasto llevan `{ gastoId, actorId, actorName, gastoName }`. Los de edición llevan `{ purchaseId, actorName, gastoName }`, y `edicion.aprobada` se envía a las dos partes con `actorId`. Los de pagos llevan `{ purchaseId, actorName }`; `pago.pendiente` además lleva `copyId`, el gasto de quien recibe el evento, para que el cliente actualice esa tarjeta sin recargar; `compartido.aprobado` y `compartido.rechazado` llevan `{ gastoId, entityId, receiverName, gastoName }` (de `gastosRepository.getCopyNotificationData`); `compartido.descartado` se envía a las dos partes con `{ gastoId, actorId, actorName }`, donde `gastoId` es el gasto de quien lo recibe; `compartido.desvinculado` se envía a la otra parte con `{ gastoId, gastoName, actorId, actorName, confirmedPayments }`. Un evento nuevo necesita su handler en los dos clientes y su texto en `utils/push-messages.js`.

**Notificaciones persistentes**: después del COMMIT, `triggerCompartidos` llama a `registrarNotificacion` (`utils/notifications.js`), que guarda en `notifications` todo evento de `PusherEvent` salvo la acción propia (`actorId`), solo con los campos de `CAMPOS_GUARDADOS`, y completa el nombre del gasto (y el emisor en `compartido.nuevo`) y `ownGastoId`, el gasto de ese destinatario dentro del par compartido, porque el id del evento puede ser el de la otra parte. No propaga errores. Si se guardó, publica además `notificacion.nueva` con `{ id }`, que no forma parte de `PusherEvent` porque no genera notificación ni push. Las rutas son `GET /notificaciones?limit=&before=` (`{ items, unread_count, next_before }`, 30 por defecto y 100 como máximo), `POST /notificaciones/:id/leer` y `POST /notificaciones/leer-todas`. La tabla se crea con `migrations/manual/2026-11-22_notificaciones.sql`.

**Push (Pusher Beams, solo Android)**: `triggerCompartidos` publica en Channels y llama a `sendPush` (`utils/push-notifications.js`) en paralelo, después del COMMIT. `sendPush` no propaga errores, no hace nada sin `BEAMS_INSTANCE_ID` y `BEAMS_SECRET_KEY`, omite las acciones propias (`actorId`) y publica con `publishToUsers`. Los textos (`es`, `en`) salen de `buildPushMessage` y no incluyen montos ni nombres de gastos. El idioma es `users.push_language` (`migrations/manual/2026-11-21_users_push_language.sql`), que la app actualiza con `PUT /user/push-language`. `GET /user/push-token?user_id=<id>` responde `{ token }` sin envolver en `data`, porque ese formato lo exige el SDK de Beams, y rechaza con `NO_AUTORIZADO` un `user_id` distinto del de la sesión.

## 7. Convenciones

- Términos del dominio y mensajes en español: gastos, entidades financieras, compartidos.
- Configuración por `config/env.js`, que carga `.env` y exporta constantes; los demás módulos importan esas constantes en vez de leer `process.env`.
- `.env` y `data.json` no se versionan.

## 8. Comandos

```
npm run dev                # node --watch index.js
npm test                   # vitest run
npm run test:watch
npm run test:coverage
npm run test:integration   # HTTP contra un Postgres local temporal
npx vitest run tests/<archivo>.test.js -t "<nombre>"
npx eslint .
```

Los tests de `npm test` son unitarios y no necesitan base de datos: los de controllers simulan el service, los de services simulan los repositories y pasan `runInTransaction: (fn) => fn()`, y `tests/db.test.js` simula postgres.js para probar los helpers de transacciones. `tests/routes.authorization.test.js` levanta las rutas reales con la base simulada y verifica que cada ruta protegida responda 401 sin un token válido y que el usuario salga del token, no del body.

Los de `tests/integration/` (`npm run test:integration`) prueban los flujos por HTTP y con SQL real. Crean un Postgres temporal con los binarios locales (`PG_BIN` cambia su carpeta; hace falta PostgreSQL 17 o superior, como producción, porque el dump de `schema.sql` usa parámetros que la 16 no conoce, y la CI instala la 17), cargan `migrations/schema.sql` y las migraciones de `PENDING_MIGRATIONS` en `support/global-setup.js`, rechazan cualquier conexión que no sea local y reemplazan Pusher por un doble. Después de ejecutar una migración en producción, se regenera `schema.sql` con `pg_dump --schema-only --no-owner --no-privileges --schema=public` y se la quita de esa lista. Los tests `it.fails` con nombre `BUG CONOCIDO` documentan un bug abierto: al corregirlo fallan hasta pasarlos a `it`.

## 9. Checklist: endpoint o recurso nuevo

- [ ] Ruta en `routes/<recurso>.routes.js` (y montada en `routes/index.js` si el recurso es nuevo).
- [ ] Factory que arma repository → service → controller.
- [ ] Controller: `userId` desde `req.session`, validación de forma con `badRequest`, `handleError` en el `catch`.
- [ ] Service: reglas de negocio y **verificación de pertenencia** del recurso al usuario. Si escribe más de una vez, en `this.tx(...)`.
- [ ] Repository: SQL parametrizado, filtrando `deleted = false`.
- [ ] Errores de dominio nuevos en el `CATALOG`.
- [ ] Movimiento de historial si la operación lo amerita.
- [ ] Evento de Pusher si afecta a otro usuario.
- [ ] Test del controller en `tests/`, y del service si agrega una regla de negocio o de pertenencia. La ruta nueva se agrega a `PROTECTED_ROUTES` en `tests/routes.authorization.test.js`.
- [ ] **Clientes**: función en `src/services/api.js` de la web y provider + repository en Flutter; códigos de error en ambos catálogos.
- [ ] **Postman**: agregar, modificar o quitar la request en `postman/expense-manager.postman_collection.json` del repo de la web. Vale para todo cambio de un endpoint, no solo para los nuevos.
- [ ] **Documentación**: ver `.claude/guides/documentacion.md` en el repo de la web (`web-plataformas-de-desarrollo`).
