# Plataforma de Gestión de Deudas — API

API REST de la **Plataforma de Gestión de Deudas**, hecha en Node.js con Express 5 sobre PostgreSQL.

## Descripción del proyecto

La API persiste los datos en PostgreSQL y hace cumplir todas las reglas de negocio del sistema:

- Registro, login con email/contraseña y login con Google; sesiones con JWT.
- Entidades financieras (personas, tarjetas, bancos, comercios), con vinculación entre usuarios.
- Gastos (egresos o ingresos) de pago único, en cuotas o fijos, en ARS, USD, EUR, BRL, CLP y UYU; pagos, cobros y reversión.
- Categorías y dashboard con totales por moneda.
- Gastos compartidos entre usuarios vinculados: aprobación de gastos y confirmación de pagos, con notificaciones en tiempo real por Pusher.
- Modo "hacer cuentas": sesiones de cierre que registran los pagos marcados y guardan un snapshot inmutable.

## Requisitos previos

- **Node.js** 20 o superior (probado con Node 22) y **npm**.
- Una base de datos **PostgreSQL** (local o hosteada) con el esquema de la aplicación.
- Una app de **Pusher Channels** (opcional: sin ella la API funciona, pero no envía notificaciones en tiempo real).

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
```

| Variable | Obligatoria | Para qué se usa |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Cadena de conexión a PostgreSQL. |
| `JWT_SECRET` | Sí | Secreto con el que se firman y verifican los JWT de sesión. |
| `PORT` | No | Puerto HTTP. Por defecto `3000`. |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | No | Credenciales de Pusher Channels para publicar los eventos de gastos compartidos. |

## Base de datos

El repo no usa ORM ni herramienta de migraciones, y **el esquema completo de PostgreSQL no está versionado acá**: se administra fuera del repo. Para levantar una base nueva hace falta partir del esquema existente (por ejemplo, un dump sin datos de la base de desarrollo).

Los cambios de esquema posteriores están en [migrations/manual/](migrations/manual/), como archivos `<fecha>_<motivo>.sql` que se ejecutan a mano, en orden de fecha, antes de desplegar el código que los necesita:

```bash
psql "$DATABASE_URL" -f migrations/manual/2026-09-03_add_detail_purchases_movements.sql
```

Para cargar datos de prueba:

```bash
node seed.js
```

> `seed.js` **vacía las tablas** antes de cargar datos falsos. No correrlo nunca contra producción.

`migrate.js` no es un migrador de esquema: es un script puntual que importa el `data.json` de una aplicación anterior.

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
| `npx eslint .` | Lint |
| `node seed.js` | Carga datos falsos (vacía las tablas antes) |

Los tests son unitarios y no necesitan una base: los de controllers mockean los services y los de services mockean los repositories.

## Arquitectura técnica

```
Cliente ──HTTP/JSON + JWT──► Express (/api) ──SQL──► PostgreSQL
   ▲                              │
   │                              └──► Pusher Channels (canal compartidos-<userId>)
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

- **Rutas** montadas en `/api`: `/auth` y `/health` son públicas; el middleware `verifyToken` protege `/user`, `/entidades-financieras`, `/dashboard`, `/gastos`, `/categorias`, `/compartidos` y `/settlement`.
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
| [@faker-js/faker](https://fakerjs.dev) | Datos falsos para `seed.js` |
| [Vitest](https://vitest.dev) | Tests unitarios y cobertura |

## Autores

- Gonzalo Rigoni
- Romina Herrera
