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
- Baja lógica: entidades, gastos y categorías llevan `deleted`. Toda consulta de lectura filtra `deleted = false`.
- Las cuotas pagas no se guardan: se cuentan los movimientos `PAYMENT` de `purchases_movements`.
- Historial: toda operación relevante registra un movimiento (`movementsRepository.createGastoLog` / `createEntidadLog`) con un tipo de `MovementType` (`utils/enums.js`). El historial de entidades es *best-effort*: si falla, se registra en el log y la operación continúa.
- Enums de dominio (`Currency`, `ExpenseType`, `ExpenseStatus`, `MovementType`) en `utils/enums.js`.
- No hay transacciones: las operaciones de varias escrituras no son atómicas. Ordenar las escrituras para que un fallo intermedio deje el estado más inocuo posible.

## 6. Tiempo real

`utils/pusher.js` expone `triggerCompartidos(userId, evento, datos)`, que publica en `compartidos-<userId>` y **nunca** propaga el error: un fallo de Pusher no debe romper la operación de negocio.

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

Los tests son unitarios y no necesitan base de datos: los de controllers simulan el service, y `tests/gastos.service.test.js` simula los repositories para probar las reglas de negocio (pertenencia, cuotas restantes).

## 9. Checklist: endpoint o recurso nuevo

- [ ] Ruta en `routes/<recurso>.routes.js` (y montada en `routes/index.js` si el recurso es nuevo).
- [ ] Factory que arma repository → service → controller.
- [ ] Controller: `userId` desde `req.session`, validación de forma con `badRequest`, `handleError` en el `catch`.
- [ ] Service: reglas de negocio y **verificación de pertenencia** del recurso al usuario.
- [ ] Repository: SQL parametrizado, filtrando `deleted = false`.
- [ ] Errores de dominio nuevos en el `CATALOG`.
- [ ] Movimiento de historial si la operación lo amerita.
- [ ] Evento de Pusher si afecta a otro usuario.
- [ ] Test del controller en `tests/`, y del service si agrega una regla de negocio o de pertenencia.
- [ ] **Clientes**: función en `src/services/api.js` de la web y provider + repository en Flutter; códigos de error en ambos catálogos.
- [ ] **Documentación**: ver `.claude\guides\documentacion.md` en el repo de la web (`c:\Users\gonza\Desktop\web-plataformas-de-desarrollo`).
