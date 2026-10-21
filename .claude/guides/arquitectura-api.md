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
- **Usuarios**: toda consulta que devuelve filas de `users` (SELECT o `RETURNING`) usa `USER_PUBLIC_COLUMNS` de `repositories/user-columns.js`, nunca `SELECT *`, así todas las respuestas traen los mismos campos (incluido `avatar`). El hash de la contraseña no sale de la API: solo lo lee `AuthRepository.findUserWithPasswordByEmail`, y `AuthService.login` lo quita antes de responder.
- Al agregar un recurso, replicar esta estructura en lugar de apartarse de ella.

## 2. Rutas y autenticación

`routes/index.js` se monta en `/api`. `/api/auth/*` es público; el middleware `verifyToken` protege todo lo demás.

Grupos: `/auth`, `/user`, `/entidades-financieras`, `/dashboard`, `/gastos`, `/categorias`, `/compartidos`, `/settlement`.

`verifyToken` valida `Authorization: Bearer <jwt>` con `JWT_SECRET` y deja el payload en `req.session` (al menos `userId`). Responde **401** si falta el token, es inválido o venció: es la señal con la que los clientes cierran la sesión. El **403** queda para un usuario autenticado sin permiso sobre el recurso (`NO_AUTORIZADO`); no devolver 401 por eso, porque deslogearía al usuario.

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

- Sin ORM y sin herramienta de migraciones: el esquema de Postgres se administra fuera del repo. `migrate.js` **no** migra el esquema; es un script puntual que importa datos de una app anterior.
- Baja lógica: entidades, gastos y categorías llevan `deleted`. Toda consulta de lectura filtra `deleted = false`, salvo el listado `GET /entidades-financieras`, que devuelve activas y eliminadas juntas con el campo `deleted` para que cada cliente las separe.
- Las cuotas pagas no se guardan: se cuentan los movimientos `PAYMENT` de `purchases_movements`.
- Edición de gastos (`PUT /gastos/:id`): el controller pasa los campos como un objeto y `GastosService.update` los valida y completa con los valores actuales los que no vienen (`undefined` = no tocar). Los campos bloqueados salen de `#editLocks(gasto, userId)` (`{ campo: motivo }`; reglas en RF-GAS-15): un cambio en uno de ellos es 409 `GASTO_CAMPO_NO_EDITABLE` con `details.field`, y el mismo valor se acepta. `getById` devuelve esos bloqueos en `edit_locks` para que los clientes deshabiliten los campos: una regla de edición nueva va en `#editLocks`, no en los clientes. Los pagos nunca se editan acá (`payed_quotas` está siempre bloqueado). Mover de entidad tiene su propio error, `GASTO_ENTIDAD_NO_EDITABLE`.
- Historial: toda operación relevante registra un movimiento (`movementsRepository.createGastoLog` / `createEntidadLog`) con un tipo de `MovementType` (`utils/enums.js`). El historial de entidades es *best-effort*: si falla, se registra en el log y la operación continúa (corre en un savepoint, ver abajo).
- Enums de dominio (`Currency`, `ExpenseType`, `ExpenseStatus`, `MovementType`) en `utils/enums.js`.

### Conexión a la base

`db.js` crea un único cliente postgres.js contra el pooler de Supabase (modo transacción, puerto 6543) con `idle_timeout: 20`, `max_lifetime: 1800` y `prepare: false`. El pooler corta las conexiones inactivas: sin `idle_timeout`, la primera consulta después de un rato sin uso fallaba. No quites estas opciones.

### Transacciones

`db.js` expone tres helpers. La transacción en curso viaja en un `AsyncLocalStorage`, así que `executeQuery` la usa sola: los repositories no reciben nada nuevo por parámetro.

- `withTransaction(fn)`: corre `fn` como una transacción (todo o nada). Si `fn` tira, se hace ROLLBACK y el error se propaga. Anidada dentro de otra, se suma a la de afuera.
- `afterCommit(fn)`: posterga un efecto externo hasta el COMMIT y lo descarta si hay ROLLBACK. Fuera de una transacción corre en el momento. `triggerCompartidos` lo usa siempre: ningún cliente se entera de un cambio que no se guardó.
- `bestEffort(fn)`: para una escritura que puede fallar sin arrastrar a la operación, como el historial de entidades. Dentro de una transacción corre en un SAVEPOINT, porque en Postgres una consulta fallida aborta la transacción entera aunque el error se atrape en JS. El error se propaga, así que el llamador lo atrapa y lo registra.

Reglas:

- **Toda operación de service con más de una escritura va en una transacción**: `return this.tx(async () => { … })`. Los services reciben `runInTransaction` por constructor (por defecto, `withTransaction`); los tests unitarios pasan `(fn) => fn()`. Una operación de una sola escritura no la necesita.
- Dentro de una transacción las consultas van por una sola conexión. Se pueden lanzar en paralelo con `Promise.all`, salvo `bestEffort`, que se espera sola: lo que corra en paralelo quedaría dentro de su savepoint.
- **Cada consulta es un viaje a la base** (~200 ms desde una máquina local contra Supabase). En las acciones frecuentes conviene ahorrarlos: verificar pertenencia y leer el gasto en una sola consulta (`#getOwnedWithOwner`), mandar en paralelo las escrituras independientes y registrar el historial de la entidad después de la transacción (sin savepoint), como hace `postergarGasto`.
- Si hay riesgo de que dos pedidos simultáneos procesen lo mismo, la fila se bloquea con `SELECT … FOR UPDATE` dentro de la transacción. Lo hace, por ejemplo, el cierre de la sesión de cuentas (`getOpenSession(userId, { forUpdate: true })`).
- Un método de repository que hace varias consultas también se envuelve en `withTransaction`, como `setCategoriasForGasto`, que hace DELETE + INSERT.

## 6. Tiempo real

`utils/pusher.js` expone `triggerCompartidos(userId, evento, datos)`, que publica en `compartidos-<userId>` y **nunca** propaga el error: un fallo de Pusher no debe romper la operación de negocio. Dentro de una transacción, el aviso sale recién después del COMMIT (`afterCommit`).

Eventos existentes: `compartido.nuevo`, `compartido.aprobado`, `compartido.rechazado`, `pago.pendiente`, `pago.confirmado`, `pago.rechazado`. Un evento nuevo necesita su handler en los dos clientes.

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
npx vitest run tests/<archivo>.test.js -t "<nombre>"
npx eslint .
node seed.js               # carga datos falsos; TRUNCA las tablas: nunca contra producción
```

Los tests son unitarios y no necesitan base de datos: los de controllers simulan el service, los de services simulan los repositories y pasan `runInTransaction: (fn) => fn()`, y `tests/db.test.js` simula postgres.js para probar los helpers de transacciones.

## 9. Checklist: endpoint o recurso nuevo

- [ ] Ruta en `routes/<recurso>.routes.js` (y montada en `routes/index.js` si el recurso es nuevo).
- [ ] Factory que arma repository → service → controller.
- [ ] Controller: `userId` desde `req.session`, validación de forma con `badRequest`, `handleError` en el `catch`.
- [ ] Service: reglas de negocio y **verificación de pertenencia** del recurso al usuario. Si escribe más de una vez, en `this.tx(...)`.
- [ ] Repository: SQL parametrizado, filtrando `deleted = false`.
- [ ] Errores de dominio nuevos en el `CATALOG`.
- [ ] Movimiento de historial si la operación lo amerita.
- [ ] Evento de Pusher si afecta a otro usuario.
- [ ] Test del controller en `tests/`, y del service si agrega una regla de negocio o de pertenencia.
- [ ] **Clientes**: función en `src/services/api.js` de la web y provider + repository en Flutter; códigos de error en ambos catálogos.
- [ ] **Documentación**: ver `.claude\guides\documentacion.md` en el repo de la web (`c:\Users\gonza\Desktop\web-plataformas-de-desarrollo`).
