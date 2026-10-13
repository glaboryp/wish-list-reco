# Listas de deseos

Plataforma web para que varios centros publiquen su propia lista de deseos y reciban donaciones por PayPal. Cada centro tiene su web en `/<centro>` (por ejemplo `/recoletos`) y la gestiona un encargado desde su panel, sin programar nada. La raíz (`/`) lista los centros activos.

## Stack

- [Astro](https://astro.build/) (SSR) + [Tailwind CSS](https://tailwindcss.com/)
- Base de datos: Postgres en [Neon](https://neon.com/)
- Autenticación: [Firebase Authentication](https://firebase.google.com/docs/auth) (solo Google); la sesión es una cookie firmada propia
- Imágenes: [Vercel Blob](https://vercel.com/docs/vercel-blob)
- Pagos: PayPal Checkout, con las credenciales de cada centro
- Despliegue: [Vercel](https://vercel.com/)

## Cómo funciona

- **Superadmin** (el correo de `SUPERADMIN_EMAIL`): en `/admin` crea centros, configura el PayPal de cada uno y da de alta a su primer encargado.
- **Encargados** (correos dados de alta por centro): en `/<centro>/admin` editan la portada, el logo, el color, los artículos con su precio, registran donaciones manuales y añaden o quitan a otros encargados.
- Lo recaudado de cada artículo es siempre la suma de su registro de donaciones (`donations`); un artículo está "financiado" cuando esa suma alcanza su precio.
- El secret de PayPal se guarda cifrado (AES-256-GCM) y nunca se muestra.

## Variables de entorno

Copia `.env.example` a `.env` y rellénalo:

| Variable | Para qué |
| --- | --- |
| `POSTGRES_URL` | Conexión a Neon |
| `NEON_FETCH_ENDPOINT` | Solo desarrollo: proxy HTTP local de Neon |
| `PRODUCTION_DB_HOST`, `ALLOW_REMOTE_DB_RESET` | Guardia de `db:seed`/`db:reset` (ver Desarrollo local) |
| `BLOB_READ_WRITE_TOKEN` | Subida de imágenes |
| `ENCRYPTION_KEY` | Clave de cifrado de los secrets de PayPal (`openssl rand -base64 32`) |
| `SESSION_SECRET` | Firma de la cookie de sesión (`openssl rand -base64 48`) |
| `SUPERADMIN_EMAIL` | Único superadmin |
| `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID` | Configuración web de Firebase |

## Desarrollo local

`pnpm dev` carga `.env.development` (versionado, sin secretos reales), que apunta a la base de datos local de Docker y sustituye a la de `.env`. Así el desarrollo nunca toca producción. Pasos:

1. Arranca Postgres y el proxy (ver [Base de datos local](#base-de-datos-local)).
2. `pnpm db:reset` migra y siembra datos ficticios.
3. `pnpm dev` (http://localhost:4321).

Para iniciar sesión con Google necesitas rellenar `PUBLIC_FIREBASE_*` en un `.env.development.local` (ignorado por git) y dar de alta tu correo como encargado, o usar tu correo como `SUPERADMIN_EMAIL` en ese mismo archivo.

### Datos de ejemplo

- `pnpm db:migrate`: aplica las migraciones.
- `pnpm db:seed`: crea (o recrea, es idempotente) dos centros, `recoletos` y `santa-clara`, con encargados (`*@example.org`), artículos en borrador, activos, casi completos, completados y archivados, imágenes de `public/`, y más de 100 donaciones (PayPal, manuales y anuladas) para probar la paginación. Las credenciales PayPal son de sandbox; usa `PAYPAL_SANDBOX_CLIENT_ID`/`PAYPAL_SANDBOX_SECRET` para poner las tuyas.
- `pnpm db:reset`: migrar + sembrar.

El seed borra y vuelve a crear los artículos, encargados y donaciones de esos dos centros. `db:seed` y `db:reset` se niegan a ejecutarse si `POSTGRES_URL` no es local (`localhost`, `127.0.0.1`, `*.localtest.me`), si coincide con `PRODUCTION_DB_HOST` o con el host de `POSTGRES_URL` en `.env`, o si `NODE_ENV=production`/`VERCEL` están definidos. Para sembrar una rama de Neon desechable, define `ALLOW_REMOTE_DB_RESET=1`. `scripts/migrate.mjs` no tiene esta guardia porque también se usa para migrar producción.

## Migraciones

Los archivos SQL están en `db/migrations/` y se aplican en orden con `node --env-file=.env scripts/migrate.mjs` (se registran en `schema_migrations`). Prueba siempre antes en una rama de Neon.

`000_baseline.sql` crea el esquema original (`items`, `item_images`, `item_status`) con `IF NOT EXISTS`, así que una base vacía queda completa tras ejecutar el script y en producción, donde ya existe, no cambia nada.

## Base de datos local

El driver de Neon habla HTTP, así que en local hace falta Postgres más el proxy HTTP de Neon:

```bash
docker network create wish-net
docker run -d --name wish-pg --network wish-net -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=main -p 5432:5432 postgres:17
docker run -d --name wish-proxy --network wish-net -p 4444:4444 \
  -e PG_CONNECTION_STRING=postgres://postgres:postgres@wish-pg:5432/main \
  ghcr.io/timowilhelm/local-neon-http-proxy:main
docker exec wish-pg psql -U postgres main -c "CREATE SCHEMA neon_control_plane; CREATE TABLE neon_control_plane.endpoints (endpoint_id text PRIMARY KEY, allowed_ips text[])"

pnpm db:reset
```

Esos valores ya están en `.env.development`; para otros comandos exporta `POSTGRES_URL=postgres://postgres:postgres@db.localtest.me:5432/main` y `NEON_FETCH_ENDPOINT=http://db.localtest.me:4444/sql`.

`db.localtest.me` resuelve a `127.0.0.1`; el proxy necesita ese nombre de host. `NEON_FETCH_ENDPOINT` solo se usa con el proxy: no lo definas contra Neon (la app lo ignora fuera de `pnpm dev`).

## Tests

```bash
pnpm test:unit                                  # Vitest
pnpm test:e2e                                   # Playwright (base de datos simulada)

TEST_DATABASE_URL=$POSTGRES_URL TEST_NEON_FETCH_ENDPOINT=$NEON_FETCH_ENDPOINT \
  pnpm exec vitest run src/tests/integration --testTimeout=30000  # contra la base local de arriba
```

CI ejecuta el job `Integration` en cada PR con el mismo Postgres y proxy como servicios, aplica las migraciones y lanza los tests de integración.

## Alta de un centro nuevo

1. En `/admin`, "Nuevo centro": identificador (la URL) y nombre.
2. En los ajustes del centro: Client ID, Secret y entorno de PayPal; añade el correo de Google del encargado.
3. El encargado entra en `/login` con Google y personaliza su web.
