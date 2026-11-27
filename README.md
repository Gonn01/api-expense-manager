# Expense Manager — API

API REST de **Expense Manager**, hecha en Node.js con Express 5 sobre PostgreSQL.

## Descripción del proyecto

La API persiste los datos en PostgreSQL y hace cumplir todas las reglas de negocio del sistema:

- Registro, login con email/contraseña y login con Google; sesiones con JWT.
- Entidades financieras (personas, tarjetas, bancos, comercios), con vinculación entre usuarios.
- Gastos (egresos o ingresos) de pago único, en cuotas o fijos, en ARS y las 35 monedas extranjeras con cotización del BCRA (lista en `utils/enums.js`); pagos, cobros y reversión.
- Categorías y dashboard con totales por moneda.
- Gastos compartidos entre usuarios vinculados: aprobación de gastos y confirmación de pagos, con notificaciones en tiempo real por Pusher.
- Modo "hacer cuentas": sesiones de cierre que registran los pagos marcados y guardan un snapshot inmutable.

## Requisitos previos

- **Node.js** 20 o superior (probado con Node 22) y **npm**.
- Una base de datos **PostgreSQL** (local o hosteada) con el esquema de la aplicación.
- Una app de **Pusher Channels** (opcional: sin ella la API funciona, pero no envía notificaciones en tiempo real).
- Una instancia de **Pusher Beams** con FCM configurado (opcional: sin ella la API no envía notificaciones push a Android).

## Instalar dependencias

```bash
git clone https://github.com/Gonn01/api-plataformas-desarrollo.git
cd api-plataformas-desarrollo
npm install
```

## Variables de entorno

Crear un archivo `.env` en la raíz (está en `.gitignore`, no se versiona). Se carga con `dotenv` desde `config/env.js`.

```env
DATABASE_URL=postgres://usuario:contraseña@localhost:5432/plataforma_deudas
JWT_SECRET=un-secreto-largo-y-aleatorio
PORT=3000

PUSHER_APP_ID=
PUSHER_KEY=
PUSHER_SECRET=
PUSHER_CLUSTER=sa1

BEAMS_INSTANCE_ID=
BEAMS_SECRET_KEY=

FIREBASE_PROJECT_ID=purchase-app-tp
FIREBASE_WEB_API_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

| Variable | Obligatoria | Para qué se usa |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Cadena de conexión a PostgreSQL. |
| `DATABASE_SSL` | No | Con `disable` conecta sin TLS. Lo usa solo el entorno local temporal; en cualquier otro caso se exige TLS. |
| `JWT_SECRET` | Sí | Secreto con el que se firman y verifican los JWT de sesión. |
| `PORT` | No | Puerto HTTP. Por defecto `3000`. |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | No | Credenciales de Pusher Channels para publicar los eventos de gastos compartidos. |
| `BEAMS_INSTANCE_ID`, `BEAMS_SECRET_KEY` | No | Credenciales de Pusher Beams para emitir tokens y enviar notificaciones push a Android. |
| `FIREBASE_PROJECT_ID` | Para entrar con Google | Proyecto de Firebase contra el que se verifican los ID tokens. Sin esta variable, `POST /api/auth/firebase-login` responde 503 `GOOGLE_NO_CONFIGURADO`. |
| `FIREBASE_WEB_API_KEY` | Para verificar el email y recuperar la contraseña | Clave web del proyecto de Firebase (la misma que `VITE_FIREBASE_API_KEY` de la web). La API la usa para validar contraseñas, crear cuentas y pedir a Firebase los mails de verificación y de recuperación. |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Para verificar el email y recuperar la contraseña | Cuenta de servicio de Firebase Admin (consola de Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada). Son los campos `client_email` (termina en `.iam.gserviceaccount.com`, no es un mail personal) y `private_key` del JSON que descarga la consola. En `FIREBASE_PRIVATE_KEY` los saltos de línea pueden ir escritos como `
`, con o sin comillas; si faltan las líneas `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`, la API las agrega (`utils/private-key.js`). Con estas dos y `FIREBASE_WEB_API_KEY`, las contraseñas se guardan en Firebase, el registro manda un mail de verificación y el inicio de sesión exige el email verificado; sin ellas la API guarda la contraseña en la base (bcrypt), no verifica el email y `POST /api/auth/resend-verification` y `POST /api/auth/forgot-password` responden 503 `AUTH_EMAIL_NO_CONFIGURADO`. En la consola de Firebase hay que habilitar el proveedor Correo electrónico/contraseña. |

## Base de datos

La API se conecta a la base PostgreSQL indicada en `DATABASE_URL`, que debe tener el esquema de la aplicación. Antes de desplegar código nuevo hay que ejecutar sus migraciones de `migrations/manual/`.

## Correr el proyecto en local

```bash
npm run dev
```

Levanta el servidor con `node --watch` (se reinicia al guardar) en `http://localhost:3000`. Para comprobar que responde y que llega a la base:

```bash
curl http://localhost:3000/api/health
```

Devuelve `200` si la base responde y `503` si no.

Los orígenes permitidos por CORS están definidos en `index.js`; para consumir la API desde un navegador en otro origen hay que agregarlo ahí.

### Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con recarga (`node --watch index.js`) |
| `node index.js` | Servidor sin recarga |
| `npm test` | Tests unitarios con Vitest |
| `npm run test:watch` | Tests en modo watch |
| `npm run test:coverage` | Tests con reporte de cobertura |
| `npm run test:integration` | Tests por HTTP contra un Postgres local temporal (requiere PostgreSQL 17 o superior instalado) |
| `npm run start:local` | API en el puerto 3100 con una base temporal y sin servicios externos |
| `npm run evidence:load -- <carpeta>` | Prueba de carga local |
| `npm run evidence:resilience -- <carpeta>` | Prueba local de caídas, backup y restauración |
| `npx eslint .` | Lint |

Los tests de `npm test` son unitarios y no necesitan una base: los de controllers mockean los services y los de services mockean los repositories. Los de integración crean una base temporal desde `migrations/schema.sql`, nunca se conectan a una base remota y la eliminan al terminar.

## Arquitectura técnica

```
Cliente ──HTTP/JSON + JWT──► Express (/api) ──SQL──► PostgreSQL
   ▲                              │
   │                              └──► Pusher Channels (canal private-notificaciones-<userId>, solo IDs)
   └──────── eventos en tiempo real ◄──┘
```

Cada recurso sigue el mismo patrón en capas, con inyección de dependencias manual:

```
routes/<recurso>.routes.js         asocia verbos HTTP al controller
factories/<recurso>.factory.js     arma repository → service → controller
controller/<recurso>.controller.js adaptador HTTP (req/res), sin lógica de negocio
services/<recurso>.service.js      reglas de negocio; lanza customError(ErrorCode.X)
repositories/<recurso>.repository.js SQL plano con executeQuery (db.js)
```

- **Rutas** montadas en `/api`: `/auth` y `/health` son públicas; el middleware `verifyToken` protege `/user`, `/entidades-financieras`, `/dashboard`, `/gastos`, `/categorias`, `/notificaciones` (con `/notificaciones/pendientes`) y `/settlement`.
- **Autenticación**: JWT en `Authorization: Bearer <token>`. 401 si falta, es inválido o venció (los clientes cierran la sesión); 403 si el usuario no tiene permiso sobre el recurso.
- **Errores**: catálogo único en `utils/errors.js` (código → status HTTP + mensaje en español). Un middleware final los convierte en respuestas JSON.
- **Transacciones**: `withTransaction` sobre `AsyncLocalStorage`; las operaciones con más de una escritura corren en una transacción y las notificaciones de Pusher se envían recién después del commit.
- **Seguridad de datos**: cada operación sobre un recurso verifica que pertenezca al usuario de la sesión, y el hash de la contraseña nunca sale de la API.

## Librerías principales

| Librería | Uso |
| --- | --- |
| [Express 5](https://expressjs.com) | Servidor HTTP y ruteo |
| [postgres](https://github.com/porsager/postgres) (postgres.js) | Cliente de PostgreSQL |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | Emisión y verificación de JWT |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | Hash de contraseñas |
| [pusher](https://github.com/pusher/pusher-http-node) | Publicación de eventos en tiempo real |
| [cors](https://github.com/expressjs/cors) | Política de CORS |
| [dotenv](https://github.com/motdotla/dotenv) | Carga del `.env` |
| [dayjs](https://day.js.org) | Fechas |
| [Vitest](https://vitest.dev) | Tests unitarios y cobertura |

## Autores

- Gonzalo Rigoni
- Romina Herrera
