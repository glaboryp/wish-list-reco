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
| `BLOB_READ_WRITE_TOKEN` | Subida de imágenes |
| `ENCRYPTION_KEY` | Clave de cifrado de los secrets de PayPal (`openssl rand -base64 32`) |
| `SESSION_SECRET` | Firma de la cookie de sesión (`openssl rand -base64 48`) |
| `SUPERADMIN_EMAIL` | Único superadmin |
| `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID` | Configuración web de Firebase |

## Desarrollo local

```bash
pnpm install
node --env-file=.env scripts/migrate.mjs      # aplica las migraciones a POSTGRES_URL
pnpm dev                      # http://localhost:4321
```

## Migraciones

Los archivos SQL están en `db/migrations/` y se aplican en orden con `node --env-file=.env scripts/migrate.mjs` (se registran en `schema_migrations`). Prueba siempre antes en una rama de Neon.

## Tests

```bash
pnpm test:unit                                  # Vitest
pnpm test:e2e                                   # Playwright (base de datos simulada)
TEST_DATABASE_URL=<rama de Neon> pnpm exec vitest run src/tests/integration
```

## Alta de un centro nuevo

1. En `/admin`, "Nuevo centro": identificador (la URL) y nombre.
2. En los ajustes del centro: Client ID, Secret y entorno de PayPal; añade el correo de Google del encargado.
3. El encargado entra en `/login` con Google y personaliza su web.
