# Multi-Center Wish List Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-center Oratorio Recoletos wish list into a multi-center platform with per-center PayPal credentials, Google login through Firebase, a superadmin panel and a per-center admin panel.

**Architecture:** One Astro SSR app on Vercel with `center_id` on tenant data in Neon Postgres. Public pages live under `/<slug>`; admin panels are server-rendered Astro pages with plain form posts. Firebase only proves identity (ID token verified with `jose`); the app issues its own signed session cookie, and authorization is always decided from the database. Raised amounts are derived from a `donations` ledger.

**Tech Stack:** Astro 7 (SSR, Vercel adapter), Tailwind 4, Neon serverless driver, `jose`, `firebase` (client sign-in), `@vercel/blob`, Vitest 5, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-02-multi-center-design.md`

## Global Constraints

- Package manager is pnpm; Node.js 24.x. Add dependencies only with `pnpm add`.
- Code identifiers and code in English; user-facing strings in Spanish (the site is Spanish).
- No code comments unless essential (user rule). SQL migration files may contain the `-- breakpoint` delimiter.
- Never commit or push without Gloria's explicit permission: every "Commit" step means "ask first". Conventional Commits in English, no `Co-authored-by` trailer, work on branch `feat/multi-center`.
- Never commit secrets or real environment values.
- Center is always derived from the URL on the server, never from the request body; every tenant query filters by `center_id`.
- `ENCRYPTION_KEY` is a base64-encoded 32-byte key; PayPal secrets are encrypted with AES-256-GCM and are write-only in every UI.
- Slugs: 2–40 chars, `^[a-z0-9]+(-[a-z0-9]+)*$`, not reserved (`admin`, `api`, `auth`, `login`, `logout`, `item`, `_astro`, `favicon`, `robots`, `sitemap`, `assets`, `static`, `public`).
- Image uploads: webp, jpg or png, max 5 MB, blob path prefixed with `<slug>/`.
- Primary color: `#rrggbb` with contrast ratio ≥ 4.5 against white.
- Existing behaviour that must not change: PayPal fee formula (`FEE_RATE = 0.029`, `FIXED_FEE = 0.35`), minimum donation 1 €, maximum donation `ceil(goal - raised)`, error messages already asserted by existing tests.
- Out of scope (spec exclusions): custom domains, email/password login, donor data, notifications, rate limiting, key rotation, renaming the Vercel project.

## Review Focus

- Item id in the URL or body that is not a UUID (`/recoletos/item/abc`, `itemId: "1"`) must give 404, never a Postgres 500 → Task 3 (`isUuid`), Task 8, Task 9.
- Donation amounts that are `NaN`, `Infinity`, strings or exponent notation (`"1e9"`) must be rejected with 400 → Task 8.
- Unknown, uppercase or reserved slugs and disabled centers must give 404 on public pages and no charge on `create-order`, while `capture-order` still captures an order the customer already approved on a center disabled mid-flow → Tasks 3, 8, 9.
- Manager input: emails with spaces/uppercase/invalid format, adding an existing manager twice, removing the last manager, and image URLs or colors that are not from our blob store / not strict hex (CSS injection through the `style` attribute) → Tasks 3, 13, 11.
- A blank PayPal secret on update must keep the stored secret, and no center read path may expose `paypal_secret_encrypted` → Tasks 5, 18.

---

## File Structure

New or changed files, by responsibility:

- `db/migrations/001_multi_center.sql` — schema + Recoletos backfill.
- `scripts/migrate.mjs`, `scripts/snapshot-totals.mjs` — migration runner and totals check.
- `src/lib/crypto.ts` — AES-256-GCM helpers.
- `src/lib/slug.ts`, `src/lib/ids.ts`, `src/lib/color.ts`, `src/lib/blob.ts`, `src/lib/http.ts` — small pure helpers.
- `src/lib/items.ts` — row → `WishlistItem` mapping and derived "funded".
- `src/lib/paypal.ts` — PayPal REST client per center.
- `src/lib/repo/{centers,items,donations,users}.ts` — all SQL.
- `src/lib/auth/{session,firebase,access,guard}.ts` — sessions, token verification, authorization.
- `src/lib/admin/forms.ts`, `src/components/admin/ui.ts` — form parsing and shared admin class names.
- `src/lib/db-mock.ts` — fixture-based fake used when `MOCK_DB=true` (E2E).
- `src/layouts/CenterPage.astro`, `src/layouts/AdminLayout.astro`, `src/components/admin/ImageUpload.astro`.
- `src/pages/index.astro`, `src/pages/[slug]/**`, `src/pages/admin/**`, `src/pages/login.astro`, `src/pages/api/**`.
- `src/middleware.ts` — headers, CSP, same-origin guard.

---

## Phase 1 — Foundation

### Task 1: Branch, dependencies and environment scaffolding

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (via pnpm), `src/env.d.ts`, `.env.example`, `vitest.config.ts`

**Interfaces:**
- Produces: env variables `ENCRYPTION_KEY`, `SESSION_SECRET`, `SUPERADMIN_EMAIL`, `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID` available as `import.meta.env.*` (typed and defined in tests).

- [ ] **Step 1: Create the branch (spec and plan files travel with it)**

Run: `git checkout -b feat/multi-center`
Expected: `Switched to a new branch 'feat/multi-center'`

- [ ] **Step 2: Record the baseline**

Run: `pnpm exec vitest run && pnpm exec astro check`
Expected: note any pre-existing failures; later tasks must not add new ones.

- [ ] **Step 3: Add dependencies**

Run: `pnpm add jose firebase @vercel/blob`
Expected: `package.json` lists the three packages; lockfile updated.

- [ ] **Step 4: Extend `src/env.d.ts`**

Replace the `ImportMetaEnv` body with:

```ts
interface ImportMetaEnv {
  readonly POSTGRES_URL: string;
  readonly BLOB_READ_WRITE_TOKEN?: string;
  readonly ENCRYPTION_KEY: string;
  readonly SESSION_SECRET: string;
  readonly SUPERADMIN_EMAIL: string;
  readonly PUBLIC_FIREBASE_API_KEY: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID: string;
}
```

(The old `PAYPAL_*` / `PUBLIC_PAYPAL_*` entries are removed here; Tasks 8 and 9 remove their last uses.)

- [ ] **Step 5: Replace `.env.example`**

```dotenv
# Neon Postgres connection URL
POSTGRES_URL=

# Vercel Blob token (image uploads)
BLOB_READ_WRITE_TOKEN=

# base64 of 32 random bytes: openssl rand -base64 32
ENCRYPTION_KEY=

# at least 32 chars: openssl rand -base64 48
SESSION_SECRET=

# The only superadmin (Google account email)
SUPERADMIN_EMAIL=

# Firebase web app config (Authentication > Google provider enabled)
PUBLIC_FIREBASE_API_KEY=
PUBLIC_FIREBASE_AUTH_DOMAIN=
PUBLIC_FIREBASE_PROJECT_ID=
```

- [ ] **Step 6: Define the new variables for Vitest**

Replace `vitest.config.ts` with:

```ts
/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

const ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
const SESSION_SECRET = 'test-session-secret-test-session-secret';

export default getViteConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      POSTGRES_URL: 'postgresql://user:password@host.com/dbname',
    },
  },
  define: {
    'import.meta.env.POSTGRES_URL': JSON.stringify('postgres://mock'),
    'import.meta.env.ENCRYPTION_KEY': JSON.stringify(ENCRYPTION_KEY),
    'import.meta.env.SESSION_SECRET': JSON.stringify(SESSION_SECRET),
    'import.meta.env.SUPERADMIN_EMAIL': JSON.stringify('boss@example.org'),
    'import.meta.env.PUBLIC_FIREBASE_PROJECT_ID': JSON.stringify('test-project'),
  },
});
```

Replace `vitest.setup.ts` with:

```ts
import { vi } from 'vitest';

vi.stubEnv('POSTGRES_URL', 'postgres://user:pass@host:5432/db');
```

- [ ] **Step 7: Run the suite**

Run: `pnpm exec vitest run`
Expected: `create-order` and `capture-order` tests now fail (they still read `PAYPAL_*`); they are rewritten in Task 8. `db.test.ts` still passes. This is the only expected breakage.

- [ ] **Step 8: Commit (ask Gloria first)**

```bash
git add package.json pnpm-lock.yaml src/env.d.ts .env.example vitest.config.ts vitest.setup.ts docs/superpowers
git commit -m "chore: add multi-center dependencies and environment scaffolding"
```

---

### Task 2: Secret encryption

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `src/tests/lib/crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain: string, keyB64: string): string`; `decryptSecret(payload: string, keyB64: string): string`. Payload format `v1:<iv>:<tag>:<ciphertext>` (base64 parts).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../lib/crypto';

const key = Buffer.alloc(32, 1).toString('base64');
const otherKey = Buffer.alloc(32, 2).toString('base64');

describe('secret encryption', () => {
  it('round-trips a secret', () => {
    expect(decryptSecret(encryptSecret('paypal-secret', key), key)).toBe('paypal-secret');
  });

  it('uses a fresh IV for every value', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('never contains the plaintext', () => {
    expect(encryptSecret('paypal-secret', key)).not.toContain('paypal-secret');
  });

  it('rejects a tampered payload', () => {
    const parts = encryptSecret('paypal-secret', key).split(':');
    const flipped = Buffer.from(parts[3], 'base64');
    flipped[0] ^= 1;
    parts[3] = flipped.toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), otherKey)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16).toString('base64'))).toThrow(
      'ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    );
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('nonsense', key)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/lib/crypto.test.ts`
Expected: FAIL (module `../../lib/crypto` not found).

- [ ] **Step 3: Implement**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function parseKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64 ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

export function encryptSecret(plain: string, keyB64: string): string {
  const key = parseKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string, keyB64: string): string {
  const key = parseKey(keyB64);
  const [version, iv, tag, encrypted] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error('Malformed encrypted secret');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/lib/crypto.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit (ask Gloria first)**

```bash
git add src/lib/crypto.ts src/tests/lib/crypto.test.ts
git commit -m "feat: add AES-256-GCM secret encryption"
```

---

### Task 3: Pure validation helpers (slug, uuid, color, blob URL, origin)

**Files:**
- Create: `src/lib/slug.ts`, `src/lib/ids.ts`, `src/lib/color.ts`, `src/lib/blob.ts`, `src/lib/http.ts`
- Test: `src/tests/lib/validators.test.ts`

**Interfaces:**
- Produces:
  - `validateSlug(slug: string): string | null` (Spanish error message or `null`), `RESERVED_SLUGS: Set<string>`
  - `isUuid(value: unknown): value is string`
  - `isHexColor(value: string): boolean`, `contrastRatio(a: string, b: string): number`, `isValidPrimaryColor(value: string): boolean`, `darken(hex: string, amount: number): string`
  - `isCenterBlobUrl(value: string, slug: string): boolean`
  - `isSameOrigin(request: Request): boolean`, `SAFE_METHODS: Set<string>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { validateSlug } from '../../lib/slug';
import { isUuid } from '../../lib/ids';
import { contrastRatio, darken, isHexColor, isValidPrimaryColor } from '../../lib/color';
import { isCenterBlobUrl } from '../../lib/blob';
import { isSameOrigin } from '../../lib/http';

describe('validateSlug', () => {
  it.each(['recoletos', 'colegio-san-jose', 'a1'])('accepts %s', (slug) => {
    expect(validateSlug(slug)).toBeNull();
  });

  it.each(['A', 'x', 'Recoletos', 'con espacio', 'doble--guion', '-inicio', 'fin-', 'ñandú', 'a'.repeat(41)])(
    'rejects %s',
    (slug) => {
      expect(validateSlug(slug)).not.toBeNull();
    },
  );

  it.each(['admin', 'api', 'auth', 'login', 'item', '_astro'])('rejects reserved slug %s', (slug) => {
    expect(validateSlug(slug)).toBe('Ese identificador está reservado');
  });
});

describe('isUuid', () => {
  it('accepts a v4 uuid', () => {
    expect(isUuid('3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c')).toBe(true);
  });

  it.each(['1', 'abc', '', undefined, null, 5, "' OR 1=1 --"])('rejects %s', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('color', () => {
  it('accepts the current brand color', () => {
    expect(isValidPrimaryColor('#007986')).toBe(true);
  });

  it.each(['#ffeb3b', '#ffffff', '#fff', 'red', '#007986;background:url(x)', '', '#00798'])(
    'rejects %s',
    (value) => {
      expect(isValidPrimaryColor(value)).toBe(false);
    },
  );

  it('detects hex colors strictly', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#a1B2c3 ')).toBe(false);
  });

  it('computes contrast against white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('darkens a color', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('#007986', 0)).toBe('#007986');
  });
});

describe('isCenterBlobUrl', () => {
  const ok = 'https://abc123.public.blob.vercel-storage.com/recoletos/foto-xyz.webp';

  it('accepts a blob URL under the center prefix', () => {
    expect(isCenterBlobUrl(ok, 'recoletos')).toBe(true);
  });

  it.each([
    ['other center', ok, 'otro'],
    ['other host', 'https://evil.example.com/recoletos/foto.webp', 'recoletos'],
    ['http', 'http://abc123.public.blob.vercel-storage.com/recoletos/f.webp', 'recoletos'],
    ['javascript', 'javascript:alert(1)', 'recoletos'],
    ['not a url', 'recoletos/foto.webp', 'recoletos'],
    ['lookalike host', 'https://x.public.blob.vercel-storage.com.evil.com/recoletos/f.webp', 'recoletos'],
  ])('rejects %s', (_name, url, slug) => {
    expect(isCenterBlobUrl(url, slug)).toBe(false);
  });
});

describe('isSameOrigin', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://wish-list.vercel.app/api/auth/logout', { method: 'POST', headers });

  it('accepts a matching Origin', () => {
    expect(isSameOrigin(req({ origin: 'https://wish-list.vercel.app' }))).toBe(true);
  });

  it('falls back to Referer', () => {
    expect(isSameOrigin(req({ referer: 'https://wish-list.vercel.app/recoletos/admin' }))).toBe(true);
  });

  it('rejects a foreign Origin and missing headers', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.example.com' }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/lib/validators.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the helpers**

`src/lib/slug.ts`:

```ts
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'auth',
  'login',
  'logout',
  'item',
  '_astro',
  'favicon',
  'robots',
  'sitemap',
  'assets',
  'static',
  'public',
]);

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 40) {
    return 'El identificador debe tener entre 2 y 40 caracteres';
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'Solo minúsculas, números y guiones simples';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'Ese identificador está reservado';
  }
  return null;
}
```

`src/lib/ids.ts`:

```ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
```

`src/lib/color.ts`:

```ts
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const MIN_CONTRAST_WITH_WHITE = 4.5;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export function isValidPrimaryColor(value: string): boolean {
  return isHexColor(value) && contrastRatio(value, '#ffffff') >= MIN_CONTRAST_WITH_WHITE;
}

export function darken(hex: string, amount: number): string {
  const [r, g, b] = channels(hex).map((c) => Math.round(c * (1 - amount)));
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
```

`src/lib/blob.ts`:

```ts
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

export function isCenterBlobUrl(value: string, slug: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith(BLOB_HOST_SUFFIX) &&
      url.pathname.startsWith(`/${slug}/`)
    );
  } catch {
    return false;
  }
}
```

`src/lib/http.ts`:

```ts
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSameOrigin(request: Request): boolean {
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/lib/validators.test.ts`
Expected: PASS. (`#007986` has contrast ≈ 5.1 with white; `#ffeb3b` ≈ 1.2.)

- [ ] **Step 5: Commit (ask Gloria first)**

```bash
git add src/lib/slug.ts src/lib/ids.ts src/lib/color.ts src/lib/blob.ts src/lib/http.ts src/tests/lib/validators.test.ts
git commit -m "feat: add slug, uuid, color, blob url and origin validators"
```

---

### Task 4: Database migration and runner

**Files:**
- Create: `db/migrations/001_multi_center.sql`, `scripts/migrate.mjs`, `scripts/snapshot-totals.mjs`

**Interfaces:**
- Produces: tables `centers`, `center_users`, `donations`; `items.center_id NOT NULL`; `items.raised_amount` dropped; enum value `archived` added to `item_status`; `schema_migrations(name, applied_at)`. Commands: `node scripts/migrate.mjs`, `node scripts/snapshot-totals.mjs before|after`.

The legacy schema is not in the repo. Known from the code: `items(id uuid, name, description, goal_amount numeric, raised_amount numeric, status item_status in (draft, active, funded), sort_order, created_at, updated_at)` and `item_images(id, item_id, image_url, alt_text, sort_order, created_at)`.

- [ ] **Step 1: Write `db/migrations/001_multi_center.sql`**

```sql
CREATE TABLE centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 40),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  hero_title text NOT NULL DEFAULT '',
  hero_text text NOT NULL DEFAULT '',
  hero_image_url text,
  logo_url text,
  primary_color text NOT NULL DEFAULT '#007986' CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  paypal_client_id text,
  paypal_secret_encrypted text,
  paypal_env text NOT NULL DEFAULT 'sandbox' CHECK (paypal_env IN ('sandbox', 'live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
-- breakpoint
CREATE TABLE center_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  firebase_uid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (center_id, email)
)
-- breakpoint
CREATE INDEX center_users_email_idx ON center_users (email)
-- breakpoint
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'archived'
-- breakpoint
INSERT INTO centers (slug, name, hero_title, hero_text, hero_image_url, logo_url)
VALUES (
  'recoletos',
  'Oratorio de Recoletos',
  'Ayúdanos a reparar los objetos litúrgicos del oratorio de Recoletos',
  $t$Recoletos es una asociación juvenil para la formación humana y espiritual de universitarias.

Este 2026 Recoletos cumple 50 años y por el transcurso del tiempo se han deteriorado algunos de los objetos litúrgicos del oratorio.

Al ser la parte más importante de la asociación, queremos arreglarla entre todos.

Como a quien cuida las cosas de Dios, Dios le cuida, os animamos a participar en este proyecto.$t$,
  '/oratorio.webp',
  '/logo_recoletos_alargado.webp'
)
-- breakpoint
ALTER TABLE items ADD COLUMN center_id uuid REFERENCES centers(id)
-- breakpoint
UPDATE items SET center_id = (SELECT id FROM centers WHERE slug = 'recoletos')
-- breakpoint
ALTER TABLE items ALTER COLUMN center_id SET NOT NULL
-- breakpoint
CREATE INDEX items_center_idx ON items (center_id, sort_order)
-- breakpoint
CREATE TABLE donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id),
  item_id uuid NOT NULL REFERENCES items(id),
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'EUR',
  source text NOT NULL CHECK (source IN ('paypal', 'manual')),
  paypal_capture_id text UNIQUE,
  note text,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source = 'paypal' AND paypal_capture_id IS NOT NULL AND voided_at IS NULL)
    OR (source = 'manual' AND paypal_capture_id IS NULL)
  )
)
-- breakpoint
CREATE INDEX donations_item_idx ON donations (item_id)
-- breakpoint
CREATE INDEX donations_center_idx ON donations (center_id, created_at DESC)
-- breakpoint
INSERT INTO donations (center_id, item_id, amount, currency, source, note)
SELECT center_id, id, raised_amount, 'EUR', 'manual', 'migration'
FROM items
WHERE raised_amount > 0
-- breakpoint
UPDATE items SET status = 'active' WHERE status = 'funded'
-- breakpoint
ALTER TABLE items DROP COLUMN raised_amount
```

- [ ] **Step 2: Write `scripts/migrate.mjs`**

```js
import { readFileSync, readdirSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('POSTGRES_URL is required');
  process.exit(1);
}

const sql = neon(url);

await sql.query(
  'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
);
const applied = new Set((await sql.query('SELECT name FROM schema_migrations')).map((row) => row.name));

const dir = new URL('../db/migrations/', import.meta.url);
const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const statements = readFileSync(new URL(file, dir), 'utf8')
    .split('-- breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await sql.transaction((tx) => [
    ...statements.map((statement) => tx.query(statement)),
    tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]),
  ]);
  console.log(`applied ${file}`);
}
console.log('migrations up to date');
```

- [ ] **Step 3: Write `scripts/snapshot-totals.mjs`**

```js
import { neon } from '@neondatabase/serverless';

const mode = process.argv[2];
if (!process.env.POSTGRES_URL || !['before', 'after'].includes(mode)) {
  console.error('Usage: POSTGRES_URL=... node scripts/snapshot-totals.mjs before|after');
  process.exit(1);
}

const sql = neon(process.env.POSTGRES_URL);

const rows =
  mode === 'before'
    ? await sql.query('SELECT id, raised_amount::numeric(10,2)::text AS raised FROM items ORDER BY id')
    : await sql.query(
        `SELECT i.id, COALESCE(SUM(d.amount) FILTER (WHERE d.voided_at IS NULL), 0)::numeric(10,2)::text AS raised
         FROM items i LEFT JOIN donations d ON d.item_id = i.id
         GROUP BY i.id ORDER BY i.id`,
      );

console.log(JSON.stringify(rows, null, 2));
```

- [ ] **Step 4: Rehearse on a throwaway Neon branch**

Create a Neon branch from the production branch (Neon console or `neonctl branches create --name rehearsal-multi-center`) and copy its connection string.

Run:
```bash
export POSTGRES_URL='<rehearsal branch url>'
node scripts/snapshot-totals.mjs before > "$TMPDIR/before.json"
node scripts/migrate.mjs
node scripts/snapshot-totals.mjs after > "$TMPDIR/after.json"
diff "$TMPDIR/before.json" "$TMPDIR/after.json" && echo TOTALS IDENTICAL
```
Expected: `applied 001_multi_center.sql`, then `TOTALS IDENTICAL`.

If `sql.transaction((tx) => ...)` / `tx.query` is rejected by the installed driver version, check the "transaction" section of the Neon serverless driver docs and adapt only the call shape in `migrate.mjs`; the statement list stays the same. If `ALTER TYPE ... ADD VALUE` is rejected inside the transaction, move that single statement into its own `002` migration applied first.

- [ ] **Step 5: Verify idempotency**

Run: `node scripts/migrate.mjs`
Expected: `migrations up to date` (nothing re-applied).

- [ ] **Step 6: Commit (ask Gloria first)**

```bash
git add db scripts
git commit -m "feat(db): add multi-center schema migration and runner"
```

---

## Phase 2 — Data layer and public site

### Task 5: Types, mapping helpers and repositories

**Files:**
- Modify: `src/types/database.ts`
- Create: `src/lib/items.ts`, `src/lib/repo/centers.ts`, `src/lib/repo/items.ts`, `src/lib/repo/donations.ts`, `src/lib/repo/users.ts`
- Test: `src/tests/lib/items.test.ts`, `src/tests/repo/repos.test.ts`

**Interfaces:**
- Produces (`src/types/database.ts`):

```ts
export type ItemStatus = 'draft' | 'active' | 'funded' | 'archived';
export type CenterStatus = 'active' | 'disabled';
export type PayPalEnv = 'sandbox' | 'live';

export interface Center {
  id: string;
  slug: string;
  name: string;
  status: CenterStatus;
  hero_title: string;
  hero_text: string;
  hero_image_url: string | null;
  logo_url: string | null;
  primary_color: string;
  paypal_client_id: string | null;
  paypal_env: PayPalEnv;
  paypal_configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface CenterWithSecret extends Center {
  paypal_secret_encrypted: string | null;
}

export interface DBItem {
  id: string;
  center_id: string;
  name: string;
  description: string | null;
  goal_amount: string;
  status: ItemStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ItemRow extends DBItem {
  raised_amount: string;
  image_url: string | null;
  alt_text: string | null;
}

export interface DBItemImage {
  id: string;
  item_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
}

export interface WishlistItem {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
  imageUrl: string | null;
  imageAlt: string | null;
  status: 'active' | 'funded';
}

export interface AdminItem {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
  status: ItemStatus;
  sortOrder: number;
  imageUrl: string | null;
  imageAlt: string | null;
  donationCount: number;
}

export interface ItemInput {
  name: string;
  description: string;
  goal: number;
  status: 'draft' | 'active';
  sortOrder: number;
  imageUrl: string | null;
  imageAlt: string | null;
}

export interface AppearanceInput {
  name: string;
  heroTitle: string;
  heroText: string;
  primaryColor: string;
  heroImageUrl: string | null;
  logoUrl: string | null;
}

export interface PayPalSettingsInput {
  clientId: string;
  env: PayPalEnv;
  secretEncrypted: string | null;
}

export interface DonationRow {
  id: string;
  item_id: string;
  item_name: string;
  amount: string;
  currency: string;
  source: 'paypal' | 'manual';
  note: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface CenterUserRow {
  email: string;
  firebase_uid: string | null;
  created_at: string;
}
```

  Repository functions (all return plain data, never throw for "not found"):
  - `centers.ts`: `listCenters(): Promise<Center[]>`, `listActiveCenters(): Promise<Center[]>`, `getCenterBySlug(slug: string): Promise<Center | null>`, `getCenterWithSecret(slug: string): Promise<CenterWithSecret | null>`, `createCenter(input: { slug: string; name: string }): Promise<Center | null>` (`null` if slug taken), `updateAppearance(centerId: string, input: AppearanceInput): Promise<void>`, `setCenterStatus(centerId: string, status: CenterStatus): Promise<void>`, `updatePaypal(centerId: string, input: PayPalSettingsInput): Promise<void>`
  - `items.ts`: `listPublicItems(centerId: string): Promise<WishlistItem[]>`, `getPublicItem(centerId: string, itemId: string): Promise<WishlistItem | null>`, `getItemImages(itemId: string): Promise<DBItemImage[]>`, `listAdminItems(centerId: string): Promise<AdminItem[]>`, `getAdminItem(centerId: string, itemId: string): Promise<AdminItem | null>`, `createItem(centerId: string, input: ItemInput): Promise<string>`, `updateItem(centerId: string, itemId: string, input: ItemInput): Promise<boolean>`, `removeOrArchiveItem(centerId: string, itemId: string): Promise<'deleted' | 'archived' | 'missing'>`
  - `donations.ts`: `recordPaypalDonation(input: { centerId: string; itemId: string; amount: string; currency: string; captureId: string }): Promise<'created' | 'duplicate' | 'item_not_found'>`, `addManualDonation(input: { centerId: string; itemId: string; amount: number; note: string }): Promise<boolean>`, `voidManualDonation(centerId: string, donationId: string): Promise<boolean>`, `listDonations(centerId: string): Promise<DonationRow[]>`
  - `users.ts`: `findMembership(centerId: string, email: string): Promise<boolean>`, `listMembershipsByEmail(email: string): Promise<{ slug: string; name: string }[]>`, `linkFirebaseUid(email: string, uid: string): Promise<void>`, `listCenterUsers(centerId: string): Promise<CenterUserRow[]>`, `addCenterUser(centerId: string, email: string): Promise<boolean>`, `removeCenterUser(centerId: string, email: string, options?: { force?: boolean }): Promise<'removed' | 'last' | 'missing'>`
  - `items.ts` (lib): `toWishlistItem(row: ItemRow): WishlistItem`, `sortForPublic(items: WishlistItem[]): WishlistItem[]`

- [ ] **Step 1: Replace `src/types/database.ts`** with the interfaces above (exact content as listed under "Produces").

- [ ] **Step 2: Write the failing tests**

`src/tests/lib/items.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sortForPublic, toWishlistItem } from '../../lib/items';
import type { ItemRow } from '../../types/database';

const row = (overrides: Partial<ItemRow> = {}): ItemRow => ({
  id: '3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c',
  center_id: '11111111-1111-4111-8111-111111111111',
  name: 'Cáliz',
  description: null,
  goal_amount: '100',
  status: 'active',
  sort_order: 0,
  created_at: '',
  updated_at: '',
  raised_amount: '40',
  image_url: null,
  alt_text: null,
  ...overrides,
});

describe('toWishlistItem', () => {
  it('maps numbers and defaults the description', () => {
    expect(toWishlistItem(row())).toMatchObject({ goal: 100, raised: 40, description: '', status: 'active' });
  });

  it('derives funded when raised reaches the goal', () => {
    expect(toWishlistItem(row({ raised_amount: '100' })).status).toBe('funded');
    expect(toWishlistItem(row({ raised_amount: '120.50' })).status).toBe('funded');
  });

  it('stays active just below the goal', () => {
    expect(toWishlistItem(row({ raised_amount: '99.99' })).status).toBe('active');
  });
});

describe('sortForPublic', () => {
  it('puts active items before funded ones and keeps the given order inside each group', () => {
    const mk = (id: string, raised: string) => toWishlistItem(row({ id, raised_amount: raised }));
    const sorted = sortForPublic([mk('a', '100'), mk('b', '0'), mk('c', '100'), mk('d', '5')]);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
```

`src/tests/repo/repos.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('../../lib/db', () => ({ default: mockSql }));

import { getCenterBySlug, getCenterWithSecret, listCenters } from '../../lib/repo/centers';
import { recordPaypalDonation, voidManualDonation } from '../../lib/repo/donations';
import { removeOrArchiveItem } from '../../lib/repo/items';
import { removeCenterUser } from '../../lib/repo/users';

const centerRow = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'recoletos',
  name: 'Recoletos',
  status: 'active',
  paypal_client_id: 'cid',
  paypal_secret_encrypted: 'v1:a:b:c',
  paypal_env: 'sandbox',
};

describe('centers repository', () => {
  beforeEach(() => mockSql.mockReset());

  it('never exposes the encrypted secret on public reads', async () => {
    mockSql.mockResolvedValue([centerRow]);
    const center = await getCenterBySlug('recoletos');
    expect(center).not.toHaveProperty('paypal_secret_encrypted');
    expect(center?.paypal_configured).toBe(true);
    expect((await listCenters())[0]).not.toHaveProperty('paypal_secret_encrypted');
  });

  it('reports paypal as not configured when the secret is missing', async () => {
    mockSql.mockResolvedValue([{ ...centerRow, paypal_secret_encrypted: null }]);
    expect((await getCenterBySlug('recoletos'))?.paypal_configured).toBe(false);
  });

  it('returns null for an unknown slug', async () => {
    mockSql.mockResolvedValue([]);
    expect(await getCenterBySlug('nope')).toBeNull();
  });

  it('only the explicit secret read returns the encrypted secret', async () => {
    mockSql.mockResolvedValue([centerRow]);
    expect((await getCenterWithSecret('recoletos'))?.paypal_secret_encrypted).toBe('v1:a:b:c');
  });
});

describe('donations repository', () => {
  beforeEach(() => mockSql.mockReset());
  const input = { centerId: 'c', itemId: 'i', amount: '10.00', currency: 'EUR', captureId: 'CAP1' };

  it('reports created when the row was inserted', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'd1' }]);
    expect(await recordPaypalDonation(input)).toBe('created');
  });

  it('reports duplicate when the capture id already exists', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ok: 1 }]);
    expect(await recordPaypalDonation(input)).toBe('duplicate');
  });

  it('reports item_not_found when nothing matched and the capture is new', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await recordPaypalDonation(input)).toBe('item_not_found');
  });

  it('voids only when a manual donation matched', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'd1' }]);
    expect(await voidManualDonation('c', 'd1')).toBe(true);
    mockSql.mockResolvedValueOnce([]);
    expect(await voidManualDonation('c', 'd2')).toBe(false);
  });
});

describe('items repository', () => {
  beforeEach(() => mockSql.mockReset());

  it.each([
    [{ deleted: '1', archived: '0' }, 'deleted'],
    [{ deleted: '0', archived: '1' }, 'archived'],
    [{ deleted: '0', archived: '0' }, 'missing'],
  ] as const)('maps %j to %s', async (row, expected) => {
    mockSql.mockResolvedValueOnce([row]);
    expect(await removeOrArchiveItem('c', 'i')).toBe(expected);
  });
});

describe('users repository', () => {
  beforeEach(() => mockSql.mockReset());

  it('removes a manager when more than one exists', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1' }]);
    expect(await removeCenterUser('c', 'a@x.org')).toBe('removed');
  });

  it('refuses to remove the last manager', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ok: 1 }]);
    expect(await removeCenterUser('c', 'a@x.org')).toBe('last');
  });

  it('reports missing when the email is not a manager', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await removeCenterUser('c', 'a@x.org')).toBe('missing');
  });

  it('lets the superadmin force-remove the last manager', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1' }]);
    expect(await removeCenterUser('c', 'a@x.org', { force: true })).toBe('removed');
    const sqlText = mockSql.mock.calls[0][0].join('?');
    expect(sqlText).not.toContain('count(*)');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm exec vitest run src/tests/lib/items.test.ts src/tests/repo/repos.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `src/lib/items.ts`**

```ts
import type { ItemRow, WishlistItem } from '../types/database';

export function toWishlistItem(row: ItemRow): WishlistItem {
  const goal = parseFloat(row.goal_amount);
  const raised = parseFloat(row.raised_amount);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    goal,
    raised,
    imageUrl: row.image_url,
    imageAlt: row.alt_text,
    status: raised >= goal ? 'funded' : 'active',
  };
}

export function sortForPublic(items: WishlistItem[]): WishlistItem[] {
  return [
    ...items.filter((item) => item.status === 'active'),
    ...items.filter((item) => item.status === 'funded'),
  ];
}
```

- [ ] **Step 5: Implement `src/lib/repo/centers.ts`**

```ts
import sql from '../db';
import type {
  AppearanceInput,
  Center,
  CenterStatus,
  CenterWithSecret,
  PayPalSettingsInput,
} from '../../types/database';

function toCenter(row: any): Center {
  const { paypal_secret_encrypted, ...rest } = row;
  return { ...rest, paypal_configured: Boolean(paypal_secret_encrypted && rest.paypal_client_id) };
}

export async function listCenters(): Promise<Center[]> {
  const rows = await sql`SELECT * FROM centers ORDER BY name ASC`;
  return rows.map(toCenter);
}

export async function listActiveCenters(): Promise<Center[]> {
  const rows = await sql`SELECT * FROM centers WHERE status = 'active' ORDER BY name ASC`;
  return rows.map(toCenter);
}

export async function getCenterBySlug(slug: string): Promise<Center | null> {
  const rows = await sql`SELECT * FROM centers WHERE slug = ${slug} LIMIT 1`;
  return rows.length > 0 ? toCenter(rows[0]) : null;
}

export async function getCenterWithSecret(slug: string): Promise<CenterWithSecret | null> {
  const rows = await sql`SELECT * FROM centers WHERE slug = ${slug} LIMIT 1`;
  if (rows.length === 0) return null;
  return { ...toCenter(rows[0]), paypal_secret_encrypted: rows[0].paypal_secret_encrypted };
}

export async function createCenter(input: { slug: string; name: string }): Promise<Center | null> {
  const rows = await sql`
    INSERT INTO centers (slug, name, hero_title)
    VALUES (${input.slug}, ${input.name}, ${input.name})
    ON CONFLICT (slug) DO NOTHING
    RETURNING *
  `;
  return rows.length > 0 ? toCenter(rows[0]) : null;
}

export async function updateAppearance(centerId: string, input: AppearanceInput): Promise<void> {
  await sql`
    UPDATE centers SET
      name = ${input.name},
      hero_title = ${input.heroTitle},
      hero_text = ${input.heroText},
      primary_color = ${input.primaryColor},
      hero_image_url = COALESCE(${input.heroImageUrl}, hero_image_url),
      logo_url = COALESCE(${input.logoUrl}, logo_url),
      updated_at = NOW()
    WHERE id = ${centerId}
  `;
}

export async function setCenterStatus(centerId: string, status: CenterStatus): Promise<void> {
  await sql`UPDATE centers SET status = ${status}, updated_at = NOW() WHERE id = ${centerId}`;
}

export async function updatePaypal(centerId: string, input: PayPalSettingsInput): Promise<void> {
  await sql`
    UPDATE centers SET
      paypal_client_id = ${input.clientId},
      paypal_env = ${input.env},
      paypal_secret_encrypted = COALESCE(${input.secretEncrypted}, paypal_secret_encrypted),
      updated_at = NOW()
    WHERE id = ${centerId}
  `;
}
```

- [ ] **Step 6: Implement `src/lib/repo/items.ts`**

```ts
import sql from '../db';
import { sortForPublic, toWishlistItem } from '../items';
import type { AdminItem, DBItemImage, ItemInput, ItemRow, WishlistItem } from '../../types/database';

export async function listPublicItems(centerId: string): Promise<WishlistItem[]> {
  const rows = await sql`
    SELECT
      i.id, i.center_id, i.name, i.description, i.goal_amount, i.status, i.sort_order, i.created_at, i.updated_at,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.center_id = ${centerId} AND i.status IN ('active', 'funded')
    ORDER BY i.sort_order ASC, i.created_at ASC
  `;
  return sortForPublic((rows as ItemRow[]).map(toWishlistItem));
}

export async function getPublicItem(centerId: string, itemId: string): Promise<WishlistItem | null> {
  const rows = await sql`
    SELECT
      i.id, i.center_id, i.name, i.description, i.goal_amount, i.status, i.sort_order, i.created_at, i.updated_at,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.id = ${itemId} AND i.center_id = ${centerId} AND i.status IN ('active', 'funded')
    LIMIT 1
  `;
  return rows.length > 0 ? toWishlistItem(rows[0] as ItemRow) : null;
}

export async function getItemImages(itemId: string): Promise<DBItemImage[]> {
  const rows = await sql`
    SELECT id, item_id, image_url, alt_text, sort_order, created_at
    FROM item_images WHERE item_id = ${itemId} ORDER BY sort_order ASC
  `;
  return rows as DBItemImage[];
}

function toAdminItem(row: any): AdminItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    goal: parseFloat(row.goal_amount),
    raised: parseFloat(row.raised_amount),
    status: row.status,
    sortOrder: row.sort_order,
    imageUrl: row.image_url,
    imageAlt: row.alt_text,
    donationCount: Number(row.donation_count),
  };
}

export async function listAdminItems(centerId: string): Promise<AdminItem[]> {
  const rows = await sql`
    SELECT
      i.id, i.name, i.description, i.goal_amount, i.status, i.sort_order,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id) AS donation_count,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.center_id = ${centerId}
    ORDER BY i.sort_order ASC, i.created_at ASC
  `;
  return rows.map(toAdminItem);
}

export async function getAdminItem(centerId: string, itemId: string): Promise<AdminItem | null> {
  const rows = await sql`
    SELECT
      i.id, i.name, i.description, i.goal_amount, i.status, i.sort_order,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id) AS donation_count,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.id = ${itemId} AND i.center_id = ${centerId}
    LIMIT 1
  `;
  return rows.length > 0 ? toAdminItem(rows[0]) : null;
}

async function setMainImage(centerId: string, itemId: string, url: string, alt: string | null): Promise<void> {
  await sql`
    WITH removed AS (
      DELETE FROM item_images
      WHERE item_id = ${itemId} AND sort_order = 0
        AND EXISTS (SELECT 1 FROM items WHERE id = ${itemId} AND center_id = ${centerId})
    )
    INSERT INTO item_images (item_id, image_url, alt_text, sort_order)
    SELECT id, ${url}, ${alt}, 0 FROM items WHERE id = ${itemId} AND center_id = ${centerId}
  `;
}

export async function createItem(centerId: string, input: ItemInput): Promise<string> {
  const rows = await sql`
    INSERT INTO items (center_id, name, description, goal_amount, status, sort_order)
    VALUES (${centerId}, ${input.name}, ${input.description}, ${input.goal}, ${input.status}, ${input.sortOrder})
    RETURNING id
  `;
  const id = rows[0].id as string;
  if (input.imageUrl) await setMainImage(centerId, id, input.imageUrl, input.imageAlt);
  return id;
}

export async function updateItem(centerId: string, itemId: string, input: ItemInput): Promise<boolean> {
  const rows = await sql`
    UPDATE items SET
      name = ${input.name},
      description = ${input.description},
      goal_amount = ${input.goal},
      status = ${input.status},
      sort_order = ${input.sortOrder},
      updated_at = NOW()
    WHERE id = ${itemId} AND center_id = ${centerId}
    RETURNING id
  `;
  if (rows.length === 0) return false;
  if (input.imageUrl) await setMainImage(centerId, itemId, input.imageUrl, input.imageAlt);
  return true;
}

export async function removeOrArchiveItem(
  centerId: string,
  itemId: string,
): Promise<'deleted' | 'archived' | 'missing'> {
  const rows = await sql`
    WITH has AS (
      SELECT EXISTS (SELECT 1 FROM donations WHERE item_id = ${itemId} AND center_id = ${centerId}) AS yes
    ),
    del AS (
      DELETE FROM items
      WHERE id = ${itemId} AND center_id = ${centerId} AND NOT (SELECT yes FROM has)
      RETURNING id
    ),
    arch AS (
      UPDATE items SET status = 'archived', updated_at = NOW()
      WHERE id = ${itemId} AND center_id = ${centerId} AND (SELECT yes FROM has)
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM del) AS deleted, (SELECT COUNT(*) FROM arch) AS archived
  `;
  if (Number(rows[0].deleted) > 0) return 'deleted';
  if (Number(rows[0].archived) > 0) return 'archived';
  return 'missing';
}
```

- [ ] **Step 7: Implement `src/lib/repo/donations.ts`**

```ts
import sql from '../db';
import type { DonationRow } from '../../types/database';

export async function recordPaypalDonation(input: {
  centerId: string;
  itemId: string;
  amount: string;
  currency: string;
  captureId: string;
}): Promise<'created' | 'duplicate' | 'item_not_found'> {
  const inserted = await sql`
    INSERT INTO donations (center_id, item_id, amount, currency, source, paypal_capture_id)
    SELECT ${input.centerId}, id, ${input.amount}, ${input.currency}, 'paypal', ${input.captureId}
    FROM items WHERE id = ${input.itemId} AND center_id = ${input.centerId}
    ON CONFLICT (paypal_capture_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return 'created';
  const existing = await sql`SELECT 1 AS ok FROM donations WHERE paypal_capture_id = ${input.captureId}`;
  return existing.length > 0 ? 'duplicate' : 'item_not_found';
}

export async function addManualDonation(input: {
  centerId: string;
  itemId: string;
  amount: number;
  note: string;
}): Promise<boolean> {
  const rows = await sql`
    INSERT INTO donations (center_id, item_id, amount, currency, source, note)
    SELECT ${input.centerId}, id, ${input.amount}, 'EUR', 'manual', ${input.note}
    FROM items WHERE id = ${input.itemId} AND center_id = ${input.centerId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function voidManualDonation(centerId: string, donationId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE donations SET voided_at = NOW()
    WHERE id = ${donationId} AND center_id = ${centerId} AND source = 'manual' AND voided_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function listDonations(centerId: string): Promise<DonationRow[]> {
  const rows = await sql`
    SELECT d.id, d.item_id, i.name AS item_name, d.amount, d.currency, d.source, d.note, d.voided_at, d.created_at
    FROM donations d JOIN items i ON i.id = d.item_id
    WHERE d.center_id = ${centerId}
    ORDER BY d.created_at DESC
    LIMIT 200
  `;
  return rows as DonationRow[];
}
```

- [ ] **Step 8: Implement `src/lib/repo/users.ts`**

```ts
import sql from '../db';
import type { CenterUserRow } from '../../types/database';

export async function findMembership(centerId: string, email: string): Promise<boolean> {
  const rows = await sql`SELECT 1 AS ok FROM center_users WHERE center_id = ${centerId} AND email = ${email}`;
  return rows.length > 0;
}

export async function listMembershipsByEmail(email: string): Promise<{ slug: string; name: string }[]> {
  const rows = await sql`
    SELECT c.slug, c.name
    FROM center_users cu JOIN centers c ON c.id = cu.center_id
    WHERE cu.email = ${email}
    ORDER BY c.name ASC
  `;
  return rows as { slug: string; name: string }[];
}

export async function linkFirebaseUid(email: string, uid: string): Promise<void> {
  await sql`UPDATE center_users SET firebase_uid = ${uid} WHERE email = ${email} AND firebase_uid IS NULL`;
}

export async function listCenterUsers(centerId: string): Promise<CenterUserRow[]> {
  const rows = await sql`
    SELECT email, firebase_uid, created_at FROM center_users
    WHERE center_id = ${centerId} ORDER BY created_at ASC
  `;
  return rows as CenterUserRow[];
}

export async function addCenterUser(centerId: string, email: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO center_users (center_id, email) VALUES (${centerId}, ${email})
    ON CONFLICT (center_id, email) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

export async function removeCenterUser(
  centerId: string,
  email: string,
  options: { force?: boolean } = {},
): Promise<'removed' | 'last' | 'missing'> {
  const removed = options.force
    ? await sql`DELETE FROM center_users WHERE center_id = ${centerId} AND email = ${email} RETURNING id`
    : await sql`
        DELETE FROM center_users
        WHERE center_id = ${centerId} AND email = ${email}
          AND (SELECT count(*) FROM center_users WHERE center_id = ${centerId}) > 1
        RETURNING id
      `;
  if (removed.length > 0) return 'removed';
  const exists = await sql`SELECT 1 AS ok FROM center_users WHERE center_id = ${centerId} AND email = ${email}`;
  return exists.length > 0 ? 'last' : 'missing';
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/lib/items.test.ts src/tests/repo/repos.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit (ask Gloria first)**

```bash
git add src/types src/lib/items.ts src/lib/repo src/tests/lib/items.test.ts src/tests/repo
git commit -m "feat: add center, item, donation and user repositories"
```

---

### Task 6: SQL integration tests against a Neon branch

The repository tests above mock SQL, so they cannot catch a wrong query. These tests run the real SQL; they are skipped unless `TEST_DATABASE_URL` is set.

**Files:**
- Test: `src/tests/integration/repo.integration.test.ts`

**Interfaces:**
- Consumes: all repository functions from Task 5; a database where `001_multi_center.sql` has been applied (the rehearsal branch from Task 4).

- [ ] **Step 1: Write the integration test**

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

vi.mock('../../lib/db', async () => {
  const { neon } = await import('@neondatabase/serverless');
  return { default: neon(process.env.TEST_DATABASE_URL ?? 'postgres://unused') };
});

import sql from '../../lib/db';
import { createCenter } from '../../lib/repo/centers';
import { addManualDonation, recordPaypalDonation, voidManualDonation } from '../../lib/repo/donations';
import { createItem, getAdminItem, listPublicItems, removeOrArchiveItem, updateItem } from '../../lib/repo/items';
import { addCenterUser, findMembership, removeCenterUser } from '../../lib/repo/users';

const itemInput = {
  name: 'Cáliz',
  description: 'desc',
  goal: 100,
  status: 'active' as const,
  sortOrder: 0,
  imageUrl: null,
  imageAlt: null,
};

describe.skipIf(!databaseUrl)('repositories against a real database', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let centerA: string;
  let centerB: string;
  let itemA: string;

  beforeAll(async () => {
    const a = await createCenter({ slug: `it-a-${suffix}`, name: 'A' });
    const b = await createCenter({ slug: `it-b-${suffix}`, name: 'B' });
    centerA = a!.id;
    centerB = b!.id;
    itemA = await createItem(centerA, itemInput);
  });

  afterAll(async () => {
    await sql`DELETE FROM donations WHERE center_id IN (${centerA}, ${centerB})`;
    await sql`DELETE FROM items WHERE center_id IN (${centerA}, ${centerB})`;
    await sql`DELETE FROM centers WHERE id IN (${centerA}, ${centerB})`;
  });

  it('refuses a duplicate slug', async () => {
    expect(await createCenter({ slug: `it-a-${suffix}`, name: 'again' })).toBeNull();
  });

  it('derives raised and funded from the ledger, and un-funds when a manual donation is voided', async () => {
    expect(await recordPaypalDonation({ centerId: centerA, itemId: itemA, amount: '60.00', currency: 'EUR', captureId: `CAP-${suffix}-1` })).toBe('created');
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 60, status: 'active' });

    expect(await addManualDonation({ centerId: centerA, itemId: itemA, amount: 40, note: 'efectivo' })).toBe(true);
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 100, status: 'funded' });

    const manual = await sql`SELECT id FROM donations WHERE item_id = ${itemA} AND source = 'manual'`;
    expect(await voidManualDonation(centerA, manual[0].id)).toBe(true);
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 60, status: 'active' });
  });

  it('does not count the same PayPal capture twice', async () => {
    const input = { centerId: centerA, itemId: itemA, amount: '5.00', currency: 'EUR', captureId: `CAP-${suffix}-2` };
    expect(await recordPaypalDonation(input)).toBe('created');
    expect(await recordPaypalDonation(input)).toBe('duplicate');
    expect((await getAdminItem(centerA, itemA))?.raised).toBe(65);
  });

  it('keeps tenants isolated', async () => {
    expect(await getAdminItem(centerB, itemA)).toBeNull();
    expect(await updateItem(centerB, itemA, itemInput)).toBe(false);
    expect(await recordPaypalDonation({ centerId: centerB, itemId: itemA, amount: '1.00', currency: 'EUR', captureId: `CAP-${suffix}-3` })).toBe('item_not_found');
    expect(await addManualDonation({ centerId: centerB, itemId: itemA, amount: 1, note: '' })).toBe(false);
    expect(await removeOrArchiveItem(centerB, itemA)).toBe('missing');
    expect(await listPublicItems(centerB)).toEqual([]);
  });

  it('archives an item with donations and deletes one without', async () => {
    expect(await removeOrArchiveItem(centerA, itemA)).toBe('archived');
    expect(await listPublicItems(centerA)).toEqual([]);
    const fresh = await createItem(centerA, itemInput);
    expect(await removeOrArchiveItem(centerA, fresh)).toBe('deleted');
  });

  it('protects the last manager', async () => {
    expect(await addCenterUser(centerA, 'one@example.org')).toBe(true);
    expect(await addCenterUser(centerA, 'one@example.org')).toBe(false);
    expect(await removeCenterUser(centerA, 'one@example.org')).toBe('last');
    expect(await addCenterUser(centerA, 'two@example.org')).toBe(true);
    expect(await removeCenterUser(centerA, 'one@example.org')).toBe('removed');
    expect(await findMembership(centerA, 'one@example.org')).toBe(false);
    expect(await removeCenterUser(centerA, 'two@example.org', { force: true })).toBe('removed');
    expect(await removeCenterUser(centerA, 'ghost@example.org')).toBe('missing');
  });
});
```

- [ ] **Step 2: Confirm it is skipped without a database**

Run: `pnpm exec vitest run src/tests/integration`
Expected: the file is reported as skipped (6 skipped), no failures.

- [ ] **Step 3: Run it against the rehearsal branch**

Run: `TEST_DATABASE_URL='<rehearsal branch url>' pnpm exec vitest run src/tests/integration`
Expected: PASS (6 tests). Any failure here is a real SQL bug in Task 5: fix the query, not the test.

- [ ] **Step 4: Commit (ask Gloria first)**

```bash
git add src/tests/integration
git commit -m "test: add database integration tests for repositories"
```

---

### Task 7: PayPal client per center

**Files:**
- Create: `src/lib/paypal.ts`
- Test: `src/tests/lib/paypal.test.ts`

**Interfaces:**
- Consumes: `decryptSecret` (Task 2), `CenterWithSecret`, `PayPalEnv` (Task 5).
- Produces:

```ts
export interface PayPalCredentials { clientId: string; clientSecret: string; env: PayPalEnv }
export interface CaptureResult { captureId: string; amount: string; currency: string; itemId: string }
export class PayPalError extends Error { readonly status?: number }
export function apiBase(env: PayPalEnv): string
export function credentialsFor(center: CenterWithSecret, encryptionKey: string): PayPalCredentials | null
export function createOrder(credentials: PayPalCredentials, input: { amount: number; description: string; itemId: string; brandName: string }): Promise<string>
export function captureOrder(credentials: PayPalCredentials, orderId: string): Promise<CaptureResult>
```

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../../lib/crypto';
import { apiBase, captureOrder, createOrder, credentialsFor, PayPalError } from '../../lib/paypal';
import type { CenterWithSecret } from '../../types/database';

const key = Buffer.alloc(32, 1).toString('base64');
const creds = { clientId: 'cid', clientSecret: 'secret', env: 'sandbox' as const };

const center = (overrides: Partial<CenterWithSecret> = {}) =>
  ({
    paypal_client_id: 'cid',
    paypal_secret_encrypted: encryptSecret('secret', key),
    paypal_env: 'live',
    ...overrides,
  }) as CenterWithSecret;

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body, text: async () => '' });

const completed = {
  status: 'COMPLETED',
  purchase_units: [
    { payments: { captures: [{ id: 'CAP1', custom_id: 'item-1', amount: { value: '12.00', currency_code: 'EUR' } }] } },
  ],
};

beforeEach(() => fetchMock.mockReset());

describe('credentialsFor', () => {
  it('decrypts the stored secret', () => {
    expect(credentialsFor(center(), key)).toEqual({ clientId: 'cid', clientSecret: 'secret', env: 'live' });
  });

  it('returns null when anything is missing', () => {
    expect(credentialsFor(center({ paypal_client_id: null }), key)).toBeNull();
    expect(credentialsFor(center({ paypal_secret_encrypted: null }), key)).toBeNull();
  });
});

describe('apiBase', () => {
  it('maps the environment to the API host', () => {
    expect(apiBase('live')).toBe('https://api-m.paypal.com');
    expect(apiBase('sandbox')).toBe('https://api-m.sandbox.paypal.com');
  });
});

describe('createOrder', () => {
  it('creates an order with the center brand name and returns its id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok({ id: 'ORDER-1' }));
    const id = await createOrder(creds, { amount: 10, description: 'Donación para: Cáliz', itemId: 'item-1', brandName: 'Recoletos' });
    expect(id).toBe('ORDER-1');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.application_context.brand_name).toBe('Recoletos');
    expect(body.purchase_units[0]).toMatchObject({ custom_id: 'item-1', amount: { currency_code: 'EUR', value: '10.00' } });
  });

  it('throws when the token request fails', async () => {
    fetchMock.mockResolvedValueOnce(fail(401, {}));
    await expect(createOrder(creds, { amount: 1, description: 'd', itemId: 'i', brandName: 'b' })).rejects.toBeInstanceOf(PayPalError);
  });
});

describe('captureOrder', () => {
  it('returns the capture details', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok(completed));
    expect(await captureOrder(creds, 'ORDER-1')).toEqual({ captureId: 'CAP1', amount: '12.00', currency: 'EUR', itemId: 'item-1' });
  });

  it('recovers an already captured order by reading it back', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(fail(422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }))
      .mockResolvedValueOnce(ok(completed));
    const result = await captureOrder(creds, 'ORDER-1');
    expect(result.captureId).toBe('CAP1');
    expect(fetchMock.mock.calls[2][0]).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1');
  });

  it('throws on other capture failures', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(fail(400, {}));
    await expect(captureOrder(creds, 'ORDER-1')).rejects.toBeInstanceOf(PayPalError);
  });

  it('throws when the order is not completed', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok({ status: 'PENDING' }));
    await expect(captureOrder(creds, 'ORDER-1')).rejects.toThrow('order not completed');
  });

  it('throws when the capture lacks the item reference', async () => {
    const broken = { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', amount: { value: '1', currency_code: 'EUR' } }] } }] };
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok(broken));
    await expect(captureOrder(creds, 'ORDER-1')).rejects.toThrow('incomplete capture data');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/lib/paypal.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/paypal.ts`**

```ts
import { decryptSecret } from './crypto';
import type { CenterWithSecret, PayPalEnv } from '../types/database';

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  env: PayPalEnv;
}

export interface CaptureResult {
  captureId: string;
  amount: string;
  currency: string;
  itemId: string;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function apiBase(env: PayPalEnv): string {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export function credentialsFor(center: CenterWithSecret, encryptionKey: string): PayPalCredentials | null {
  if (!center.paypal_client_id || !center.paypal_secret_encrypted) return null;
  return {
    clientId: center.paypal_client_id,
    clientSecret: decryptSecret(center.paypal_secret_encrypted, encryptionKey),
    env: center.paypal_env,
  };
}

async function accessToken(credentials: PayPalCredentials): Promise<string> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const res = await fetch(`${apiBase(credentials.env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new PayPalError('token request failed', res.status);
  const { access_token } = await res.json();
  return access_token;
}

export async function createOrder(
  credentials: PayPalCredentials,
  input: { amount: number; description: string; itemId: string; brandName: string },
): Promise<string> {
  const token = await accessToken(credentials);
  const res = await fetch(`${apiBase(credentials.env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: 'EUR', value: input.amount.toFixed(2) },
          description: input.description,
          custom_id: input.itemId,
          reference_id: input.itemId,
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        brand_name: input.brandName,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new PayPalError('order creation failed', res.status);
  return data.id;
}

export async function captureOrder(credentials: PayPalCredentials, orderId: string): Promise<CaptureResult> {
  const token = await accessToken(credentials);
  const base = `${apiBase(credentials.env)}/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let data: any;
  const res = await fetch(`${base}/capture`, { method: 'POST', headers });
  data = await res.json();
  if (!res.ok) {
    const alreadyCaptured = data?.details?.some((d: any) => d.issue === 'ORDER_ALREADY_CAPTURED');
    if (!alreadyCaptured) throw new PayPalError('capture failed', res.status);
    const readBack = await fetch(base, { headers });
    data = await readBack.json();
    if (!readBack.ok) throw new PayPalError('order lookup failed', readBack.status);
  }

  if (data.status !== 'COMPLETED') throw new PayPalError(`order not completed: ${data.status}`);
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture?.id || !capture.amount?.value || !capture.custom_id) {
    throw new PayPalError('incomplete capture data');
  }
  return {
    captureId: capture.id,
    amount: capture.amount.value,
    currency: capture.amount.currency_code,
    itemId: capture.custom_id,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/lib/paypal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (ask Gloria first)**

```bash
git add src/lib/paypal.ts src/tests/lib/paypal.test.ts
git commit -m "feat: add per-center PayPal client with idempotent capture recovery"
```

---

### Task 8: Per-center PayPal API routes

**Files:**
- Create: `src/pages/api/[slug]/paypal/create-order.ts`, `src/pages/api/[slug]/paypal/capture-order.ts`
- Delete: `src/pages/api/paypal/create-order.ts`, `src/pages/api/paypal/capture-order.ts`
- Modify: `src/tests/api/create-order.test.ts`, `src/tests/api/capture-order.test.ts`

**Interfaces:**
- Consumes: `getCenterWithSecret` (T5), `getPublicItem` (T5), `recordPaypalDonation` (T5), `credentialsFor`/`createOrder`/`captureOrder`/`PayPalError` (T7), `isUuid` (T3).
- Produces: `POST /api/<slug>/paypal/create-order` → `{ id }`; `POST /api/<slug>/paypal/capture-order` → `{ ok: true, amount, currency, itemId, captureId, duplicate }` (on database failure after capture: 500 `{ error, paymentId, itemId, amount }`).

- [ ] **Step 1: Replace `src/tests/api/create-order.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterWithSecret, getPublicItem, credentialsFor, createOrder } = vi.hoisted(() => ({
  getCenterWithSecret: vi.fn(),
  getPublicItem: vi.fn(),
  credentialsFor: vi.fn(),
  createOrder: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecret }));
vi.mock('../../lib/repo/items', () => ({ getPublicItem }));
vi.mock('../../lib/paypal', () => ({ credentialsFor, createOrder }));

import { POST } from '../../pages/api/[slug]/paypal/create-order';

const ITEM_ID = '3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c';
const center = { id: 'c1', slug: 'recoletos', name: 'Recoletos', status: 'active' };
const item = { id: ITEM_ID, name: 'Cáliz', goal: 100, raised: 50, status: 'active' };

const call = (body: unknown, slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getCenterWithSecret.mockResolvedValue(center);
  getPublicItem.mockResolvedValue(item);
  credentialsFor.mockReturnValue({ clientId: 'cid', clientSecret: 's', env: 'sandbox' });
  createOrder.mockResolvedValue('ORDER-123');
});

describe('POST /api/[slug]/paypal/create-order', () => {
  it('returns 404 for an unknown center', async () => {
    getCenterWithSecret.mockResolvedValue(null);
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(404);
  });

  it('returns 404 for a disabled center and does not charge', async () => {
    getCenterWithSecret.mockResolvedValue({ ...center, status: 'disabled' });
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(404);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('returns 400 if data is missing', async () => {
    const response = await call({});
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Faltan datos');
  });

  it('returns 404 for an item id that is not a uuid without touching the database', async () => {
    expect((await call({ itemId: '1', amount: 10 })).status).toBe(404);
    expect(getPublicItem).not.toHaveBeenCalled();
  });

  it.each([-5, 0, 0.5, 'abc', 'Infinity', Infinity, null])('returns 400 for amount %s', async (amount) => {
    const response = await call({ itemId: ITEM_ID, amount });
    expect(response.status).toBe(400);
  });

  it('returns 400 for exponent notation that exceeds the remaining goal', async () => {
    const response = await call({ itemId: ITEM_ID, amount: '1e9' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('supera lo necesario');
  });

  it('returns 404 if the item is not found in this center', async () => {
    getPublicItem.mockResolvedValue(null);
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(404);
    expect(getPublicItem).toHaveBeenCalledWith('c1', ITEM_ID);
  });

  it('returns 400 if the item is already funded', async () => {
    getPublicItem.mockResolvedValue({ ...item, raised: 100, status: 'funded' });
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(400);
  });

  it('returns 400 if the donation exceeds what is missing', async () => {
    const response = await call({ itemId: ITEM_ID, amount: 51 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('supera lo necesario');
  });

  it('returns 503 when the center has no PayPal credentials', async () => {
    credentialsFor.mockReturnValue(null);
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(503);
  });

  it('creates the order with the center brand name', async () => {
    const response = await call({ itemId: ITEM_ID, amount: 10 });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe('ORDER-123');
    expect(createOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 10, itemId: ITEM_ID, brandName: 'Recoletos' }),
    );
  });

  it('adds the PayPal fees when the donor covers them', async () => {
    await call({ itemId: ITEM_ID, amount: 10, coverFees: true });
    expect(createOrder.mock.calls[0][1].amount).toBe(10.66);
  });

  it('returns 500 when PayPal fails', async () => {
    createOrder.mockRejectedValue(new Error('boom'));
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(500);
  });
});
```

- [ ] **Step 2: Replace `src/tests/api/capture-order.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterWithSecret, recordPaypalDonation, credentialsFor, captureOrder } = vi.hoisted(() => ({
  getCenterWithSecret: vi.fn(),
  recordPaypalDonation: vi.fn(),
  credentialsFor: vi.fn(),
  captureOrder: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecret }));
vi.mock('../../lib/repo/donations', () => ({ recordPaypalDonation }));
vi.mock('../../lib/paypal', () => ({ credentialsFor, captureOrder }));

import { POST } from '../../pages/api/[slug]/paypal/capture-order';

const capture = { captureId: 'CAP1', amount: '12.00', currency: 'EUR', itemId: 'item-1' };
const center = { id: 'c1', slug: 'recoletos', status: 'active' };

const call = (body: unknown, slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getCenterWithSecret.mockResolvedValue(center);
  credentialsFor.mockReturnValue({ clientId: 'cid', clientSecret: 's', env: 'sandbox' });
  captureOrder.mockResolvedValue(capture);
  recordPaypalDonation.mockResolvedValue('created');
});

describe('POST /api/[slug]/paypal/capture-order', () => {
  it('returns 404 for an unknown center', async () => {
    getCenterWithSecret.mockResolvedValue(null);
    expect((await call({ orderID: 'O1' })).status).toBe(404);
  });

  it('returns 400 if orderID is missing', async () => {
    expect((await call({})).status).toBe(400);
  });

  it('returns 503 without credentials', async () => {
    credentialsFor.mockReturnValue(null);
    expect((await call({ orderID: 'O1' })).status).toBe(503);
  });

  it('returns 500 if the capture fails', async () => {
    captureOrder.mockRejectedValue(new Error('boom'));
    expect((await call({ orderID: 'O1' })).status).toBe(500);
    expect(recordPaypalDonation).not.toHaveBeenCalled();
  });

  it('records the donation against the center of the route', async () => {
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, amount: '12.00', itemId: 'item-1', duplicate: false });
    expect(recordPaypalDonation).toHaveBeenCalledWith({
      centerId: 'c1',
      itemId: 'item-1',
      amount: '12.00',
      currency: 'EUR',
      captureId: 'CAP1',
    });
  });

  it('is idempotent when the capture was already recorded', async () => {
    recordPaypalDonation.mockResolvedValue('duplicate');
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
  });

  it('still captures an approved order when the center was disabled mid-flow', async () => {
    getCenterWithSecret.mockResolvedValue({ ...center, status: 'disabled' });
    expect((await call({ orderID: 'O1' })).status).toBe(200);
  });

  it('reports the payment id when the database write fails after capture', async () => {
    recordPaypalDonation.mockRejectedValue(new Error('db down'));
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ paymentId: 'CAP1', itemId: 'item-1', amount: '12.00' });
  });

  it('reports the payment id when the item does not belong to the center', async () => {
    recordPaypalDonation.mockResolvedValue('item_not_found');
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(500);
    expect((await response.json()).paymentId).toBe('CAP1');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm exec vitest run src/tests/api`
Expected: FAIL (route modules not found).

- [ ] **Step 4: Create `src/pages/api/[slug]/paypal/create-order.ts`**

```ts
import type { APIRoute } from 'astro';
import { isUuid } from '../../../../lib/ids';
import { createOrder, credentialsFor } from '../../../../lib/paypal';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { getPublicItem } from '../../../../lib/repo/items';

const FEE_RATE = 0.029;
const FIXED_FEE = 0.35;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const center = await getCenterWithSecret(params.slug ?? '');
    if (!center || center.status !== 'active') {
      return json({ error: 'Centro no encontrado' }, 404);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Faltan datos requeridos (itemId, amount)' }, 400);
    }
    const { itemId, amount, coverFees } = body ?? {};

    if (!itemId || amount === undefined || amount === null) {
      return json({ error: 'Faltan datos requeridos (itemId, amount)' }, 400);
    }
    if (!isUuid(itemId)) {
      return json({ error: 'Artículo no encontrado' }, 404);
    }

    const donationAmount = Number(amount);
    if (!Number.isFinite(donationAmount) || donationAmount < 1) {
      return json({ error: 'La cantidad debe ser mayor o igual a 1€' }, 400);
    }

    const item = await getPublicItem(center.id, itemId);
    if (!item) {
      return json({ error: 'Artículo no encontrado' }, 404);
    }
    if (item.status === 'funded') {
      return json({ error: 'Este artículo ya ha sido financiado' }, 400);
    }

    const remaining = Math.ceil(item.goal - item.raised);
    if (donationAmount > remaining) {
      return json({ error: `La cantidad supera lo necesario para financiar el artículo (${remaining}€)` }, 400);
    }

    const credentials = credentialsFor(center, import.meta.env.ENCRYPTION_KEY);
    if (!credentials) {
      return json({ error: 'Este centro todavía no acepta donaciones' }, 503);
    }

    let purchaseAmount = donationAmount;
    if (coverFees) {
      purchaseAmount = Math.round(((donationAmount + FIXED_FEE) / (1 - FEE_RATE)) * 100) / 100;
    }

    const id = await createOrder(credentials, {
      amount: purchaseAmount,
      description: `Donación para: ${item.name}`,
      itemId,
      brandName: center.name,
    });
    return json({ id });
  } catch (error) {
    console.error('Error creando orden PayPal', error);
    return json({ error: 'Error al crear la orden de pago' }, 500);
  }
};
```

- [ ] **Step 5: Create `src/pages/api/[slug]/paypal/capture-order.ts`**

```ts
import type { APIRoute } from 'astro';
import { captureOrder, credentialsFor } from '../../../../lib/paypal';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { recordPaypalDonation } from '../../../../lib/repo/donations';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request }) => {
  const center = await getCenterWithSecret(params.slug ?? '');
  if (!center) {
    return json({ error: 'Centro no encontrado' }, 404);
  }

  let orderID: unknown;
  try {
    ({ orderID } = await request.json());
  } catch {
    orderID = undefined;
  }
  if (typeof orderID !== 'string' || !orderID) {
    return json({ error: 'orderID requerido' }, 400);
  }

  const credentials = credentialsFor(center, import.meta.env.ENCRYPTION_KEY);
  if (!credentials) {
    return json({ error: 'Este centro todavía no acepta donaciones' }, 503);
  }

  let capture;
  try {
    capture = await captureOrder(credentials, orderID);
  } catch (error) {
    console.error('Error en captura PayPal', error);
    return json({ error: 'Fallo al capturar la orden' }, 500);
  }

  const failure = {
    error: 'Pago capturado pero error al registrar la donación',
    paymentId: capture.captureId,
    itemId: capture.itemId,
    amount: capture.amount,
  };

  let outcome;
  try {
    outcome = await recordPaypalDonation({
      centerId: center.id,
      itemId: capture.itemId,
      amount: capture.amount,
      currency: capture.currency,
      captureId: capture.captureId,
    });
  } catch (error) {
    console.error('Error registrando donación', failure, error);
    return json(failure, 500);
  }

  if (outcome === 'item_not_found') {
    console.error('Donación capturada para un artículo que no pertenece al centro', failure);
    return json(failure, 500);
  }

  return json({
    ok: true,
    amount: capture.amount,
    currency: capture.currency,
    itemId: capture.itemId,
    captureId: capture.captureId,
    duplicate: outcome === 'duplicate',
  });
};
```

- [ ] **Step 6: Remove the legacy routes**

Run: `git rm src/pages/api/paypal/create-order.ts src/pages/api/paypal/capture-order.ts`
Expected: both files removed.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/api`
Expected: PASS. (Fees check: `(10 + 0.35) / (1 - 0.029) = 10.6591…`, rounded to `10.66`; the formula is unchanged from the original code.)

- [ ] **Step 8: Commit (ask Gloria first)**

```bash
git add src/pages/api src/tests/api
git commit -m "feat: serve PayPal order endpoints per center with idempotent donation recording"
```

---

### Task 9: Public pages, layout and mock database

**Files:**
- Create: `src/lib/db-mock.ts`, `src/layouts/CenterPage.astro`, `src/pages/[slug]/index.astro`, `src/pages/[slug]/item/[id].astro`
- Modify: `src/lib/db.ts`, `src/pages/index.astro` (becomes the center list), `src/pages/item/[id].astro` (becomes a redirect), `src/components/WishlistItem.astro`, `src/components/DonationForm.astro`, `tests/e2e/donation-flow.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: `getCenterBySlug`, `listActiveCenters` (T5), `listPublicItems`, `getPublicItem`, `getItemImages` (T5), `isUuid` (T3), `darken`, `isHexColor` (T3).
- Produces: routes `/`, `/<slug>`, `/<slug>/item/<id>`, legacy `/item/<id>` → 301 to `/recoletos/item/<id>`; `WishlistItem` and `DonationForm` take a new `slug` prop; `CenterPage` layout props `{ title: string; primaryColor?: string; paypalClientId?: string | null }`.


- [ ] **Step 1: Create `src/lib/db-mock.ts`** (fixtures for E2E; one manager, `manager@example.org`, belongs to `recoletos` only)

```ts
const RECOLETOS_ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_EMAIL = 'manager@example.org';

const baseCenter = {
  status: 'active',
  hero_title: 'Ayúdanos a reparar el oratorio',
  hero_text: 'Primer párrafo.\n\nSegundo párrafo.',
  hero_image_url: null,
  logo_url: null,
  primary_color: '#007986',
  paypal_client_id: 'test',
  paypal_secret_encrypted: 'v1:a:b:c',
  paypal_env: 'sandbox',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const centers = [
  { ...baseCenter, id: RECOLETOS_ID, slug: 'recoletos', name: 'Recoletos' },
  { ...baseCenter, id: OTRO_ID, slug: 'otro', name: 'Otro centro' },
];

const item = {
  id: ITEM_ID,
  center_id: RECOLETOS_ID,
  name: 'Cáliz',
  description: 'Un cáliz para el oratorio',
  goal_amount: '100',
  raised_amount: '25',
  status: 'active',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  image_url: null,
  alt_text: null,
};

export function mockSql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join('?');
  const has = (value: string) => values.includes(value);

  if (text.includes('JOIN centers')) {
    return has(MANAGER_EMAIL) ? [{ slug: 'recoletos', name: 'Recoletos' }] : [];
  }
  if (text.includes('FROM center_users')) {
    return has(RECOLETOS_ID) && has(MANAGER_EMAIL) ? [{ ok: 1 }] : [];
  }
  if (text.includes('FROM centers')) {
    const found = centers.filter((center) => has(center.slug));
    return found.length > 0 ? found : values.length === 0 ? centers : [];
  }
  if (text.includes('FROM items')) {
    return has(RECOLETOS_ID) ? [item] : [];
  }
  return [];
}
```

- [ ] **Step 2: Use it from `src/lib/db.ts`** (replace the whole file)

```ts
import { neon } from '@neondatabase/serverless';
import { mockSql } from './db-mock';

const url = import.meta.env.POSTGRES_URL;

if (!url) {
    throw new Error('POSTGRES_URL no está configurada');
}

const sql: any = process.env.MOCK_DB === 'true' ? mockSql : neon(url);

export default sql;
```

- [ ] **Step 3: Create `src/layouts/CenterPage.astro`**

```astro
---
import "../styles/global.css";
import Analytics from '@vercel/analytics/astro';
import SpeedInsights from "@vercel/speed-insights/astro";
import { darken, isHexColor } from "../lib/color";

interface Props {
  title: string;
  primaryColor?: string;
  paypalClientId?: string | null;
}

const { title, primaryColor = '#007986', paypalClientId = null } = Astro.props;
const color = isHexColor(primaryColor) ? primaryColor : '#007986';
const hover = darken(color, 0.2);
---

<html lang="es">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/webp" href="/favicon.webp" />
    <meta name="viewport" content="width=device-width" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
    {paypalClientId && (
      <script src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&currency=EUR&intent=capture&disable-funding=paylater&components=buttons`} data-sdk-integration-source="astro" data-namespace="paypal"></script>
    )}
  </head>
  <body class="antialiased" style={`--primary: ${color}; --primary-hover: ${hover};`}>
    <slot />
    <Analytics />
    <SpeedInsights />
  </body>
</html>
```

- [ ] **Step 4: Replace `src/pages/index.astro`** (list of centers)

```astro
---
import CenterPage from "../layouts/CenterPage.astro";
import { listActiveCenters } from "../lib/repo/centers";

const centers = await listActiveCenters();
---

<CenterPage title="Listas de deseos">
  <main class="mx-auto max-w-4xl px-4 py-16">
    <h1 class="text-4xl font-bold text-center text-gray-900 mb-3">Listas de deseos</h1>
    <p class="text-center text-gray-600 mb-12">Elige un centro para ver sus necesidades y colaborar.</p>
    {centers.length === 0 ? (
      <p class="text-center text-gray-500">Todavía no hay centros disponibles.</p>
    ) : (
      <ul class="grid gap-6 sm:grid-cols-2">
        {centers.map((center) => (
          <li>
            <a
              href={`/${center.slug}`}
              class="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-md transition-shadow hover:shadow-lg"
            >
              {center.logo_url && <img src={center.logo_url} alt="" class="h-12 w-auto object-contain" />}
              <span class="text-xl font-semibold text-gray-900">{center.name}</span>
            </a>
          </li>
        ))}
      </ul>
    )}
  </main>
</CenterPage>
```

- [ ] **Step 5: Create `src/pages/[slug]/index.astro`**

```astro
---
import CenterPage from "../../layouts/CenterPage.astro";
import WishlistItem from "../../components/WishlistItem.astro";
import { getCenterBySlug } from "../../lib/repo/centers";
import { listPublicItems } from "../../lib/repo/items";

const { slug } = Astro.params;
const center = slug ? await getCenterBySlug(slug) : null;

if (!center || center.status !== 'active') {
  return new Response('Centro no encontrado', { status: 404 });
}

const items = await listPublicItems(center.id);
const paragraphs = center.hero_text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const paypalClientId = center.paypal_configured ? center.paypal_client_id : null;
---

<CenterPage title={`${center.name} - Lista de deseos`} primaryColor={center.primary_color} paypalClientId={paypalClientId}>
  <section class="relative h-[600px] flex items-center justify-center overflow-hidden rounded-2xl mx-4 mt-6 mb-12 bg-gray-800">
    <div class="absolute inset-0 bg-gradient-to-b from-black/60 to-black/40">
      {center.hero_image_url && (
        <img src={center.hero_image_url} alt="" class="w-full h-full object-cover" />
      )}
    </div>

    <div class="relative z-10 text-center px-4 max-w-3xl">
      {center.logo_url && (
        <img src={center.logo_url} alt={center.name} class="mx-auto mb-8 h-16 w-auto object-contain" />
      )}
      <h1 class="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-12 drop-shadow-lg">
        {center.hero_title || center.name}
      </h1>
      <a
        href="#wishlist"
        class="inline-block text-white font-semibold px-8 py-3 rounded-lg shadow-lg transition-colors"
        style="background-color: var(--primary);"
        onmouseover="this.style.backgroundColor='var(--primary-hover)'"
        onmouseout="this.style.backgroundColor='var(--primary)'"
      >
        Ver la lista de deseos y contribuir
      </a>
    </div>
  </section>

  {paragraphs.length > 0 && (
    <section class="mx-auto max-w-4xl px-4 mb-16">
      <div class="bg-white rounded-2xl shadow-lg p-8 md:p-12 border border-gray-100">
        <h2 class="text-3xl font-bold text-gray-900 mb-6 text-center">Explicación del proyecto</h2>
        <div class="max-w-none text-lg text-gray-700 leading-relaxed space-y-4">
          {paragraphs.map((paragraph) => <p>{paragraph}</p>)}
        </div>
      </div>
    </section>
  )}

  <main class="mx-auto max-w-6xl px-4 pb-16">
    <h2 id="wishlist" class="text-3xl font-bold text-center text-gray-900 mb-10">Nuestra lista de deseos</h2>

    {items.length === 0 ? (
      <p class="text-center text-gray-500">Todavía no hay artículos en la lista.</p>
    ) : (
      <section class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <WishlistItem item={item} slug={center.slug} enablePayPal={center.paypal_configured} />
        ))}
      </section>
    )}
  </main>
</CenterPage>
```

- [ ] **Step 6: Create `src/pages/[slug]/item/[id].astro`**

```astro
---
import CenterPage from "../../../layouts/CenterPage.astro";
import DonationForm from "../../../components/DonationForm.astro";
import { isUuid } from "../../../lib/ids";
import { getCenterBySlug } from "../../../lib/repo/centers";
import { getItemImages, getPublicItem } from "../../../lib/repo/items";

const { slug, id } = Astro.params;
const center = slug ? await getCenterBySlug(slug) : null;

if (!center || center.status !== 'active') {
  return new Response('Centro no encontrado', { status: 404 });
}
if (!isUuid(id)) {
  return Astro.redirect(`/${center.slug}`);
}

const item = await getPublicItem(center.id, id);
if (!item) {
  return Astro.redirect(`/${center.slug}`);
}

const images = await getItemImages(item.id);
const progress = Math.min(100, Math.round((item.raised / item.goal) * 100));
const isFunded = item.status === 'funded';
const remaining = Math.max(0, item.goal - item.raised);
const maxDonation = Math.ceil(remaining);
const paypalClientId = center.paypal_configured && !isFunded ? center.paypal_client_id : null;
---

<CenterPage title={`${item.name} - ${center.name}`} primaryColor={center.primary_color} paypalClientId={paypalClientId}>
  <main class="mx-auto max-w-6xl px-4 py-10">
    <a href={`/${center.slug}#wishlist`} class="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6 transition-colors">
      <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Volver a la lista
    </a>

    <div class="grid lg:grid-cols-2 gap-8">
      <div class="space-y-4">
        {images.length > 0 ? (
          <>
            <div class="aspect-video rounded-xl overflow-hidden bg-gray-100 shadow-lg">
              <img src={images[0].image_url} alt={images[0].alt_text || item.name} class="w-full h-full object-cover" id="main-image" />
            </div>
            {images.length > 1 && (
              <div class="grid grid-cols-4 gap-3">
                {images.map((img, idx) => (
                  <button
                    type="button"
                    class="aspect-square rounded-lg overflow-hidden bg-gray-100 border-2 border-transparent hover:border-red-500 transition-colors cursor-pointer"
                    data-src={img.image_url}
                  >
                    <img src={img.image_url} alt={img.alt_text || `${item.name} - Imagen ${idx + 1}`} class="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div class="aspect-video rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <p class="text-gray-400">Sin imágenes disponibles</p>
          </div>
        )}
      </div>

      <div class="space-y-6">
        {isFunded && (
          <div class="inline-flex items-center bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-semibold">
            ✓ Completado
          </div>
        )}

        <div>
          <h1 class="text-4xl font-bold text-gray-900 mb-3">{item.name}</h1>
          <p class="text-lg text-gray-600 leading-relaxed" style="white-space: pre-line;">{item.description}</p>
        </div>

        <div class="bg-gray-50 rounded-xl p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-600">Recaudado</p>
              <p class="text-3xl font-bold text-gray-900">{item.raised.toFixed(0)} €</p>
            </div>
            <div class="text-right">
              <p class="text-sm text-gray-600">Meta</p>
              <p class="text-2xl font-semibold text-gray-700">{item.goal.toFixed(0)} €</p>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between text-sm mb-2">
              <span class="text-gray-600 font-medium">{progress}% completado</span>
              {!isFunded && <span class="text-gray-600">Faltan {remaining.toFixed(0)} €</span>}
            </div>
            <div class="h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                class={`h-full transition-all ${isFunded ? 'bg-green-500' : ''}`}
                style={isFunded ? { width: `${progress}%` } : { width: `${progress}%`, backgroundColor: 'var(--primary)' }}
              />
            </div>
          </div>
        </div>

        {isFunded ? (
          <div class="bg-green-50 rounded-xl border-2 border-green-200 p-6 text-center">
            <div class="text-green-600 text-5xl mb-3">🎉</div>
            <h2 class="text-xl font-bold text-green-900 mb-2">¡Meta Alcanzada!</h2>
            <p class="text-green-700">Gracias a todos los que contribuyeron para hacer esto posible.</p>
          </div>
        ) : center.paypal_configured ? (
          <div class="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-4">
            <h2 class="text-xl font-bold text-gray-900">Contribuir a este artículo</h2>
            <DonationForm itemId={item.id} itemName={item.name} slug={center.slug} maxDonation={maxDonation} isDetailPage={true} />
          </div>
        ) : (
          <div class="bg-gray-50 rounded-xl border-2 border-gray-200 p-6 text-center text-gray-600">
            Las donaciones de este centro estarán disponibles muy pronto.
          </div>
        )}
      </div>
    </div>
  </main>

  <script>
    document.querySelectorAll<HTMLButtonElement>('button[data-src]').forEach((button) => {
      button.addEventListener('click', () => {
        const main = document.getElementById('main-image') as HTMLImageElement | null;
        if (main && button.dataset.src) main.src = button.dataset.src;
      });
    });
  </script>
</CenterPage>
```

- [ ] **Step 7: Replace `src/pages/item/[id].astro`** (legacy redirect)

```astro
---
const { id } = Astro.params;
return Astro.redirect(`/recoletos/item/${encodeURIComponent(id ?? '')}`, 301);
---
```

- [ ] **Step 8: Update `src/components/WishlistItem.astro`**

Change the props line to:

```astro
const { item, slug, enablePayPal = false } = Astro.props as { item: Item; slug: string; enablePayPal?: boolean };
```

Replace all three occurrences of ``href={`/item/${item.id}`}`` with ``href={`/${slug}/item/${item.id}`}``.

Change the form usage to:

```astro
<DonationForm itemId={item.id} itemName={item.name} slug={slug} maxDonation={maxDonation} />
```

- [ ] **Step 9: Update `src/components/DonationForm.astro`**

In the frontmatter, replace the `Props` interface and destructuring with:

```astro
interface Props {
  itemId: string;
  itemName: string;
  slug: string;
  maxDonation: number;
  isDetailPage?: boolean;
}

const { itemId, itemName, slug, maxDonation, isDetailPage = false } = Astro.props;
```

In `define:vars`, add `slug`:

```astro
  define:vars={{
    inputId,
    buttonId,
    itemId,
    itemName,
    slug,
    maxDonation,
    isDetailPage,
  }}
```

Replace `fetch("/api/paypal/create-order", {` with ``fetch(`/api/${slug}/paypal/create-order`, {``.

Replace the whole `onApprove` handler with a retrying version (capture is idempotent on the server):

```js
      onApprove: async (data) => {
        const attempts = 3;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const r = await fetch(`/api/${slug}/paypal/capture-order`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderID: data.orderID }),
            });
            const json = await r.json();

            if (r.ok) {
              showToast(
                "¡Pago completado con éxito! Gracias por tu contribución 🎉",
                "success",
              );
              setTimeout(() => window.location.reload(), 2000);
              return;
            }
            if (r.status < 500 || attempt === attempts) {
              hideLoading();
              isProcessing = false;
              showToast(json.error || "Error al procesar el pago", "error");
              return;
            }
          } catch (e) {
            if (attempt === attempts) {
              hideLoading();
              isProcessing = false;
              showToast("Error de red al capturar el pago", "error");
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      },
```

- [ ] **Step 10: Update the E2E test and Playwright config**

Replace `tests/e2e/donation-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('Donation flow', async ({ page }) => {
    await page.route('https://www.paypal.com/sdk/js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.paypal = {
                FUNDING: { PAYPAL: 'paypal', CARD: 'card' },
                Buttons: () => ({ render: () => Promise.resolve() }),
            };`,
        }),
    );

    await page.goto('/recoletos');
    await expect(page).toHaveTitle(/Lista de deseos/);

    const items = page.locator('article');
    await expect(items.first()).toBeVisible();

    await items.first().locator('a[href^="/recoletos/item/"]').first().click();

    await expect(page.url()).toContain('/recoletos/item/');
    await expect(page.locator('h1')).toBeVisible();

    const amountInput = page.locator('input[name="amount"]');
    await expect(amountInput).toBeVisible();

    await amountInput.fill('999999');
    await amountInput.blur();
    await expect(page.locator('text=La cantidad no puede superar')).toBeVisible();

    await amountInput.fill('10');
    await amountInput.blur();
    await expect(page.locator('text=La cantidad no puede superar')).not.toBeVisible();
});

test('Home lists the active centers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Recoletos' })).toBeVisible();
});

test('Unknown and uppercase slugs give 404', async ({ request }) => {
    expect((await request.get('/no-existe')).status()).toBe(404);
    expect((await request.get('/Recoletos')).status()).toBe(404);
});

test('Legacy item URLs redirect to the Recoletos center', async ({ request }) => {
    const response = await request.get('/item/33333333-3333-4333-8333-333333333333', { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toBe('/recoletos/item/33333333-3333-4333-8333-333333333333');
});

test('A non-uuid item id does not crash the page', async ({ request }) => {
    const response = await request.get('/recoletos/item/abc', { maxRedirects: 0 });
    expect(response.status()).toBe(302);
});
```

In `playwright.config.ts`, replace the `webServer.env` block with:

```ts
        env: {
            MOCK_DB: 'true',
            POSTGRES_URL: 'postgresql://user:password@host.com/dbname',
            ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
            SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
            SUPERADMIN_EMAIL: 'boss@example.org',
            PUBLIC_FIREBASE_API_KEY: 'e2e',
            PUBLIC_FIREBASE_AUTH_DOMAIN: 'e2e.firebaseapp.com',
            PUBLIC_FIREBASE_PROJECT_ID: 'e2e',
        },
```

- [ ] **Step 11: Verify**

Run: `pnpm exec vitest run && pnpm exec astro check && pnpm exec playwright test`
Expected: unit tests PASS; `astro check` introduces no new errors versus the Task 1 baseline; all Playwright tests PASS. If the "Home lists the active centers" link name differs, adjust to the fixture name `Recoletos`.

- [ ] **Step 12: Commit (ask Gloria first)**

```bash
git add src tests playwright.config.ts
git commit -m "feat: serve the wish list per center under /<slug>"
```

---

## Phase 3 — Authentication and authorization

### Task 10: Session cookie and Firebase token verification

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/firebase.ts`
- Test: `src/tests/auth/session.test.ts`, `src/tests/auth/firebase.test.ts`

**Interfaces:**
- Produces:

```ts
export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS: number;
export interface SessionPayload { email: string; uid: string }
export function signSession(payload: SessionPayload, secret: string, ttlSeconds?: number): Promise<string>
export function verifySession(token: string, secret: string): Promise<SessionPayload | null>
export interface FirebaseIdentity { uid: string; email: string }
export function verifyFirebaseIdToken(idToken: string, projectId: string, keys?: JWTVerifyGetKey): Promise<FirebaseIdentity>
```

- [ ] **Step 1: Write `src/tests/auth/session.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../../lib/auth/session';

const secret = 'a'.repeat(40);
const payload = { email: 'ana@example.org', uid: 'uid-1' };

describe('session cookie', () => {
  it('round-trips the payload', async () => {
    expect(await verifySession(await signSession(payload, secret), secret)).toEqual(payload);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signSession(payload, secret);
    expect(await verifySession(token, 'b'.repeat(40))).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await signSession(payload, secret);
    const [header, body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), email: 'boss@example.org' })).toString('base64url');
    expect(await verifySession(`${header}.${forged}.${signature}`, secret)).toBeNull();
  });

  it('rejects an expired token', async () => {
    expect(await verifySession(await signSession(payload, secret, -10), secret)).toBeNull();
  });

  it('rejects an unsigned token', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({ sub: 'uid-1', email: payload.email })}.`;
    expect(await verifySession(token, secret)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifySession('not-a-token', secret)).toBeNull();
  });

  it('refuses to sign with a short secret', async () => {
    await expect(signSession(payload, 'short')).rejects.toThrow('SESSION_SECRET');
  });
});
```

- [ ] **Step 2: Write `src/tests/auth/firebase.test.ts`**

```ts
import { SignJWT, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyFirebaseIdToken } from '../../lib/auth/firebase';

const projectId = 'demo-project';
let privateKey: CryptoKey;
let publicKey: CryptoKey;
const keys = async () => publicKey;

const mint = (claims: Record<string, unknown> = {}, options: { aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT({
    email: 'Ana@Example.org',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('uid-1')
    .setIssuer(options.iss ?? `https://securetoken.google.com/${projectId}`)
    .setAudience(options.aud ?? projectId)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '1h')
    .sign(privateKey);

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair('RS256'));
});

describe('verifyFirebaseIdToken', () => {
  it('returns the uid and the lowercase email', async () => {
    expect(await verifyFirebaseIdToken(await mint(), projectId, keys)).toEqual({ uid: 'uid-1', email: 'ana@example.org' });
  });

  it('rejects another project audience', async () => {
    await expect(verifyFirebaseIdToken(await mint({}, { aud: 'other' }), projectId, keys)).rejects.toThrow();
  });

  it('rejects another issuer', async () => {
    await expect(verifyFirebaseIdToken(await mint({}, { iss: 'https://evil.example.com' }), projectId, keys)).rejects.toThrow();
  });

  it('rejects an unverified email', async () => {
    await expect(verifyFirebaseIdToken(await mint({ email_verified: false }), projectId, keys)).rejects.toThrow();
  });

  it('rejects a provider other than Google', async () => {
    await expect(
      verifyFirebaseIdToken(await mint({ firebase: { sign_in_provider: 'password' } }), projectId, keys),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    await expect(verifyFirebaseIdToken(await mint({}, { exp: '-1h' }), projectId, keys)).rejects.toThrow();
  });

  it('rejects a token signed by an unknown key', async () => {
    const other = await generateKeyPair('RS256');
    const foreign = await verifyFirebaseIdToken(await mint(), projectId, async () => other.publicKey).catch(() => 'rejected');
    expect(foreign).toBe('rejected');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm exec vitest run src/tests/auth`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `src/lib/auth/session.ts`**

```ts
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 5 * 24 * 60 * 60;

export interface SessionPayload {
  email: string;
  uid: string;
}

function signingKey(secret: string): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.uid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(signingKey(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || !payload.sub) return null;
    return { email: payload.email, uid: payload.sub };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement `src/lib/auth/firebase.ts`**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_KEYS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

let remoteKeys: JWTVerifyGetKey | undefined;
const googleKeys: JWTVerifyGetKey = (header, token) => {
  remoteKeys ??= createRemoteJWKSet(GOOGLE_KEYS_URL);
  return remoteKeys(header, token);
};

export interface FirebaseIdentity {
  uid: string;
  email: string;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<FirebaseIdentity> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const provider = (payload as { firebase?: { sign_in_provider?: string } }).firebase?.sign_in_provider;
  if (!payload.sub || !email || payload.email_verified !== true || provider !== 'google.com') {
    throw new Error('Unacceptable identity');
  }
  return { uid: payload.sub, email };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/auth`
Expected: PASS.

- [ ] **Step 7: Commit (ask Gloria first)**

```bash
git add src/lib/auth src/tests/auth
git commit -m "feat(auth): add session cookie signing and Firebase ID token verification"
```

---

### Task 11: Authorization, origin guard and CSP

**Files:**
- Create: `src/lib/auth/access.ts`, `src/lib/auth/guard.ts`
- Modify: `src/middleware.ts`
- Test: `src/tests/auth/access.test.ts`, `src/tests/middleware.test.ts`

**Interfaces:**
- Consumes: `verifySession`, `SESSION_COOKIE` (T10); `getCenterBySlug` (T5); `findMembership` (T5); `isSameOrigin`, `SAFE_METHODS` (T3).
- Produces:

```ts
export interface Actor { email: string; uid: string; isSuperadmin: boolean }
export interface CookieReader { get(name: string): { value: string } | undefined }
export type AccessResult = { ok: true; actor: Actor; center: Center } | { ok: false; status: 401 | 403 | 404 }
export type SuperadminResult = { ok: true; actor: Actor } | { ok: false; status: 401 | 403 }
export function isSuperadminEmail(email: string): boolean
export function getActor(cookies: CookieReader): Promise<Actor | null>
export function authorizeCenter(actor: Actor | null, slug: string): Promise<AccessResult>
export function authorizeSuperadmin(actor: Actor | null): SuperadminResult
// guard.ts
export function guardCenter(astro: GuardContext): Promise<{ actor: Actor; center: Center } | Response>
export function guardSuperadmin(astro: GuardContext): Promise<{ actor: Actor } | Response>
```

- [ ] **Step 1: Write `src/tests/auth/access.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterBySlug, findMembership } = vi.hoisted(() => ({
  getCenterBySlug: vi.fn(),
  findMembership: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterBySlug }));
vi.mock('../../lib/repo/users', () => ({ findMembership }));

import { authorizeCenter, authorizeSuperadmin, getActor, isSuperadminEmail } from '../../lib/auth/access';
import { SESSION_COOKIE, signSession } from '../../lib/auth/session';

const secret = 'test-session-secret-test-session-secret';
const center = { id: 'c1', slug: 'recoletos', status: 'active' };
const manager = { email: 'ana@example.org', uid: 'u1', isSuperadmin: false };
const boss = { email: 'boss@example.org', uid: 'u0', isSuperadmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  getCenterBySlug.mockResolvedValue(center);
  findMembership.mockResolvedValue(true);
});

describe('isSuperadminEmail', () => {
  it('matches only the configured email', () => {
    expect(isSuperadminEmail('boss@example.org')).toBe(true);
    expect(isSuperadminEmail('ana@example.org')).toBe(false);
    expect(isSuperadminEmail('')).toBe(false);
  });
});

describe('getActor', () => {
  const cookies = (value?: string) => ({ get: (name: string) => (name === SESSION_COOKIE && value ? { value } : undefined) });

  it('returns null without a cookie or with a bad one', async () => {
    expect(await getActor(cookies())).toBeNull();
    expect(await getActor(cookies('garbage'))).toBeNull();
  });

  it('builds the actor from a valid cookie', async () => {
    const token = await signSession({ email: 'ana@example.org', uid: 'u1' }, secret);
    expect(await getActor(cookies(token))).toEqual(manager);
  });

  it('flags the superadmin', async () => {
    const token = await signSession({ email: 'boss@example.org', uid: 'u0' }, secret);
    expect((await getActor(cookies(token)))?.isSuperadmin).toBe(true);
  });
});

describe('authorizeCenter', () => {
  it('requires a session', async () => {
    expect(await authorizeCenter(null, 'recoletos')).toEqual({ ok: false, status: 401 });
  });

  it('returns 404 for an unknown center', async () => {
    getCenterBySlug.mockResolvedValue(null);
    expect(await authorizeCenter(manager, 'nope')).toEqual({ ok: false, status: 404 });
  });

  it('lets a registered manager in', async () => {
    const result = await authorizeCenter(manager, 'recoletos');
    expect(result).toMatchObject({ ok: true, center });
    expect(findMembership).toHaveBeenCalledWith('c1', 'ana@example.org');
  });

  it('refuses a manager of another center', async () => {
    findMembership.mockResolvedValue(false);
    expect(await authorizeCenter(manager, 'recoletos')).toEqual({ ok: false, status: 403 });
  });

  it('lets the superadmin into any center without a membership', async () => {
    findMembership.mockResolvedValue(false);
    expect(await authorizeCenter(boss, 'recoletos')).toMatchObject({ ok: true });
  });

  it('lets the superadmin into a disabled center', async () => {
    getCenterBySlug.mockResolvedValue({ ...center, status: 'disabled' });
    expect(await authorizeCenter(boss, 'recoletos')).toMatchObject({ ok: true });
  });
});

describe('authorizeSuperadmin', () => {
  it('maps the three outcomes', () => {
    expect(authorizeSuperadmin(null)).toEqual({ ok: false, status: 401 });
    expect(authorizeSuperadmin(manager)).toEqual({ ok: false, status: 403 });
    expect(authorizeSuperadmin(boss)).toEqual({ ok: true, actor: boss });
  });
});
```

- [ ] **Step 2: Write `src/tests/middleware.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { onRequest } from '../middleware';

const run = (request: Request) =>
  (onRequest as any)({ request }, async () => new Response('ok', { status: 200 })) as Promise<Response>;

describe('middleware', () => {
  it('sets the security headers and a CSP that allows Firebase, Google and Blob', async () => {
    const response = await run(new Request('https://wish-list.vercel.app/'));
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(csp).toContain('https://www.paypal.com');
    expect(csp).toContain('https://identitytoolkit.googleapis.com');
    expect(csp).toContain('https://securetoken.googleapis.com');
    expect(csp).toContain('https://apis.google.com');
    expect(csp).toContain('https://*.firebaseapp.com');
    expect(csp).toContain('https://*.vercel-storage.com');
  });

  it('lets safe methods through without an Origin', async () => {
    expect((await run(new Request('https://wish-list.vercel.app/'))).status).toBe(200);
  });

  it('rejects a cross-origin POST', async () => {
    const response = await run(
      new Request('https://wish-list.vercel.app/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example.com' } }),
    );
    expect(response.status).toBe(403);
  });

  it('rejects a POST with no Origin or Referer', async () => {
    expect((await run(new Request('https://wish-list.vercel.app/x', { method: 'POST' }))).status).toBe(403);
  });

  it('accepts a same-origin POST', async () => {
    const response = await run(
      new Request('https://wish-list.vercel.app/x', { method: 'POST', headers: { origin: 'https://wish-list.vercel.app' } }),
    );
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm exec vitest run src/tests/auth/access.test.ts src/tests/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/lib/auth/access.ts`**

```ts
import { getCenterBySlug } from '../repo/centers';
import { findMembership } from '../repo/users';
import type { Center } from '../../types/database';
import { SESSION_COOKIE, verifySession } from './session';

export interface Actor {
  email: string;
  uid: string;
  isSuperadmin: boolean;
}

export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export type AccessResult =
  | { ok: true; actor: Actor; center: Center }
  | { ok: false; status: 401 | 403 | 404 };

export type SuperadminResult = { ok: true; actor: Actor } | { ok: false; status: 401 | 403 };

export function isSuperadminEmail(email: string): boolean {
  const superadmin = (import.meta.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  return superadmin !== '' && email === superadmin;
}

export async function getActor(cookies: CookieReader): Promise<Actor | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token, import.meta.env.SESSION_SECRET);
  if (!session) return null;
  return { email: session.email, uid: session.uid, isSuperadmin: isSuperadminEmail(session.email) };
}

export async function authorizeCenter(actor: Actor | null, slug: string): Promise<AccessResult> {
  if (!actor) return { ok: false, status: 401 };
  const center = await getCenterBySlug(slug);
  if (!center) return { ok: false, status: 404 };
  if (actor.isSuperadmin) return { ok: true, actor, center };
  if (!(await findMembership(center.id, actor.email))) return { ok: false, status: 403 };
  return { ok: true, actor, center };
}

export function authorizeSuperadmin(actor: Actor | null): SuperadminResult {
  if (!actor) return { ok: false, status: 401 };
  if (!actor.isSuperadmin) return { ok: false, status: 403 };
  return { ok: true, actor };
}
```

- [ ] **Step 5: Implement `src/lib/auth/guard.ts`**

```ts
import type { AstroGlobal } from 'astro';
import type { Center } from '../../types/database';
import { authorizeCenter, authorizeSuperadmin, getActor, type Actor } from './access';

type GuardContext = Pick<AstroGlobal, 'cookies' | 'params' | 'redirect'>;

function deny(astro: GuardContext, status: 401 | 403 | 404): Response {
  if (status === 401) return astro.redirect('/login');
  if (status === 403) return new Response('No tienes acceso a esta página', { status: 403 });
  return new Response('Centro no encontrado', { status: 404 });
}

export async function guardCenter(astro: GuardContext): Promise<{ actor: Actor; center: Center } | Response> {
  const result = await authorizeCenter(await getActor(astro.cookies), astro.params.slug ?? '');
  return result.ok ? { actor: result.actor, center: result.center } : deny(astro, result.status);
}

export async function guardSuperadmin(astro: GuardContext): Promise<{ actor: Actor } | Response> {
  const result = authorizeSuperadmin(await getActor(astro.cookies));
  return result.ok ? { actor: result.actor } : deny(astro, result.status);
}
```

- [ ] **Step 6: Replace `src/middleware.ts`**

```ts
import { defineMiddleware } from 'astro:middleware';
import { isSameOrigin, SAFE_METHODS } from './lib/http';

const CSP = [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "script-src 'self' 'unsafe-inline' https://www.paypal.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.vercel-storage.com https://vercel.com",
    "frame-src https://www.paypal.com https://www.sandbox.paypal.com https://*.firebaseapp.com https://accounts.google.com",
].join('; ') + ';';

export const onRequest = defineMiddleware(async (context: any, next: any) => {
    if (!SAFE_METHODS.has(context.request.method) && !isSameOrigin(context.request)) {
        return new Response('Forbidden', { status: 403 });
    }

    const response = await next();

    const headers = response.headers;

    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set('Content-Security-Policy', CSP);

    return response;
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/auth src/tests/middleware.test.ts`
Expected: PASS. If the `astro:middleware` import cannot resolve under Vitest, the existing config already uses `getViteConfig`, which provides it; otherwise stub it in the test with `vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }))`.

- [ ] **Step 8: Commit (ask Gloria first)**

```bash
git add src/lib/auth src/middleware.ts src/tests
git commit -m "feat(auth): add center authorization, same-origin guard and Firebase CSP"
```

---

### Task 12: Login page and session endpoints

**Files:**
- Create: `src/pages/login.astro`, `src/pages/api/auth/session.ts`, `src/pages/api/auth/logout.ts`
- Test: `src/tests/api/auth-session.test.ts`

**Interfaces:**
- Consumes: `verifyFirebaseIdToken`, `signSession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS` (T10); `isSuperadminEmail` (T11); `listMembershipsByEmail`, `linkFirebaseUid` (T5).
- Produces: `POST /api/auth/session` body `{ idToken }` → `{ redirect }` and sets the cookie; `POST /api/auth/logout` clears it and redirects to `/login` with 303.

- [ ] **Step 1: Write `src/tests/api/auth-session.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyFirebaseIdToken, listMembershipsByEmail, linkFirebaseUid } = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  listMembershipsByEmail: vi.fn(),
  linkFirebaseUid: vi.fn(),
}));

vi.mock('../../lib/auth/firebase', () => ({ verifyFirebaseIdToken }));
vi.mock('../../lib/repo/users', () => ({ listMembershipsByEmail, linkFirebaseUid }));

import { POST as logout } from '../../pages/api/auth/logout';
import { POST as createSession } from '../../pages/api/auth/session';

const call = (body: unknown) => {
  const cookies = { set: vi.fn() };
  const promise = createSession({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    cookies,
  } as any);
  return { cookies, promise };
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyFirebaseIdToken.mockResolvedValue({ uid: 'u1', email: 'ana@example.org' });
  listMembershipsByEmail.mockResolvedValue([{ slug: 'recoletos', name: 'Recoletos' }]);
});

describe('POST /api/auth/session', () => {
  it('returns 400 without an idToken', async () => {
    const { promise } = call({});
    expect((await promise).status).toBe(400);
  });

  it('returns 401 when the token does not verify', async () => {
    verifyFirebaseIdToken.mockRejectedValue(new Error('bad'));
    const { promise, cookies } = call({ idToken: 'x' });
    expect((await promise).status).toBe(401);
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it('returns 403 for an email that manages no center', async () => {
    listMembershipsByEmail.mockResolvedValue([]);
    const { promise, cookies } = call({ idToken: 'x' });
    const response = await promise;
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('ningún centro');
    expect(cookies.set).not.toHaveBeenCalled();
    expect(linkFirebaseUid).not.toHaveBeenCalled();
  });

  it('creates a session for a manager and links the uid', async () => {
    const { promise, cookies } = call({ idToken: 'x' });
    const response = await promise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirect: '/recoletos/admin' });
    expect(linkFirebaseUid).toHaveBeenCalledWith('ana@example.org', 'u1');
    expect(cookies.set).toHaveBeenCalledWith(
      'session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('sends the superadmin to /admin even without memberships', async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: 'u0', email: 'boss@example.org' });
    listMembershipsByEmail.mockResolvedValue([]);
    const { promise } = call({ idToken: 'x' });
    expect(await (await promise).json()).toEqual({ redirect: '/admin' });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie and redirects to /login', async () => {
    const cookies = { delete: vi.fn() };
    const redirect = (url: string, status: number) => new Response(null, { status, headers: { Location: url } });
    const response = await logout({ cookies, redirect } as any);
    expect(cookies.delete).toHaveBeenCalledWith('session', { path: '/' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/login');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/api/auth-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/pages/api/auth/session.ts`**

```ts
import type { APIRoute } from 'astro';
import { isSuperadminEmail } from '../../../lib/auth/access';
import { verifyFirebaseIdToken } from '../../../lib/auth/firebase';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from '../../../lib/auth/session';
import { linkFirebaseUid, listMembershipsByEmail } from '../../../lib/repo/users';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  let idToken: unknown;
  try {
    ({ idToken } = await request.json());
  } catch {
    idToken = undefined;
  }
  if (typeof idToken !== 'string' || !idToken) {
    return json({ error: 'Falta el token de acceso' }, 400);
  }

  let identity;
  try {
    identity = await verifyFirebaseIdToken(idToken, import.meta.env.PUBLIC_FIREBASE_PROJECT_ID);
  } catch {
    return json({ error: 'No se pudo verificar tu cuenta de Google' }, 401);
  }

  const isSuperadmin = isSuperadminEmail(identity.email);
  const memberships = await listMembershipsByEmail(identity.email);
  if (!isSuperadmin && memberships.length === 0) {
    return json({ error: 'Este correo no tiene acceso a ningún centro' }, 403);
  }

  await linkFirebaseUid(identity.email, identity.uid);

  const token = await signSession({ email: identity.email, uid: identity.uid }, import.meta.env.SESSION_SECRET);
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return json({ redirect: isSuperadmin ? '/admin' : `/${memberships[0].slug}/admin` });
};
```

- [ ] **Step 4: Implement `src/pages/api/auth/logout.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth/session';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login', 303);
};
```

- [ ] **Step 5: Create `src/pages/login.astro`**

```astro
---
import "../styles/global.css";
---

<html lang="es">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/webp" href="/favicon.webp" />
    <meta name="viewport" content="width=device-width" />
    <title>Entrar - Listas de deseos</title>
  </head>
  <body class="antialiased">
    <main class="mx-auto max-w-md px-4 py-24 text-center">
      <h1 class="text-3xl font-bold text-gray-900 mb-3">Acceso al panel</h1>
      <p class="text-gray-600 mb-8">Entra con la cuenta de Google que tiene dado de alta tu centro.</p>
      <button
        id="google-login"
        type="button"
        class="inline-flex items-center rounded-lg bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
      >
        Entrar con Google
      </button>
      <p id="login-error" class="mt-4 text-sm text-red-600" hidden></p>
    </main>

    <script>
      import { initializeApp } from 'firebase/app';
      import { GoogleAuthProvider, getAuth, signInWithPopup } from 'firebase/auth';

      const app = initializeApp({
        apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
        authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
      });

      const button = document.getElementById('google-login') as HTMLButtonElement;
      const errorBox = document.getElementById('login-error') as HTMLElement;

      const fail = (message: string) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
        button.disabled = false;
      };

      button.addEventListener('click', async () => {
        button.disabled = true;
        errorBox.hidden = true;
        try {
          const result = await signInWithPopup(getAuth(app), new GoogleAuthProvider());
          const idToken = await result.user.getIdToken();
          const response = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });
          const body = await response.json();
          if (!response.ok) {
            fail(body.error ?? 'No se pudo iniciar sesión');
            return;
          }
          window.location.assign(body.redirect);
        } catch {
          fail('No se pudo iniciar sesión con Google');
        }
      });
    </script>
  </body>
</html>
```

- [ ] **Step 6: Run to verify the unit tests pass**

Run: `pnpm exec vitest run src/tests/api/auth-session.test.ts && pnpm exec astro check`
Expected: PASS; no new `astro check` errors.

- [ ] **Step 7: Manual check with a real Firebase project (not automatable)**

1. In the Firebase console create a project, enable Authentication → Google, and register a web app; copy its config into `.env` (`PUBLIC_FIREBASE_*`). Add `localhost` and the production domain under Authentication → Settings → Authorized domains.
2. Set `SUPERADMIN_EMAIL` to your Google email and run `pnpm dev`.
3. Open `/login`, sign in with Google. Expected: redirected to `/admin` (404 until Task 18 — that is fine; the cookie `session` must be set, `HttpOnly`).
4. Sign in with a Google account that is not registered. Expected: the page shows "Este correo no tiene acceso a ningún centro" and no cookie is set.

- [ ] **Step 8: Commit (ask Gloria first)**

```bash
git add src/pages/login.astro src/pages/api/auth src/tests/api/auth-session.test.ts
git commit -m "feat(auth): add Google login page and session endpoints"
```

---

## Phase 4 — Center admin panel

### Task 13: Admin form parsing

**Files:**
- Create: `src/lib/admin/forms.ts`
- Test: `src/tests/admin/forms.test.ts`

**Interfaces:**
- Consumes: `isCenterBlobUrl`, `isValidPrimaryColor`, `isUuid`, `validateSlug` (T3); `AppearanceInput`, `ItemInput`, `PayPalEnv` (T5).
- Produces:

```ts
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
export interface PayPalFormInput { clientId: string; env: PayPalEnv; secret: string | null }
export function parseEmail(raw: unknown): Parsed<string>
export function parseAppearance(form: FormData, slug: string): Parsed<AppearanceInput>
export function parseItem(form: FormData, slug: string): Parsed<ItemInput>
export function parseManualDonation(form: FormData): Parsed<{ itemId: string; amount: number; note: string }>
export function parsePaypal(form: FormData): Parsed<PayPalFormInput>
export function parseNewCenter(form: FormData): Parsed<{ slug: string; name: string }>
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  parseAppearance,
  parseEmail,
  parseItem,
  parseManualDonation,
  parseNewCenter,
  parsePaypal,
} from '../../lib/admin/forms';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const BLOB = 'https://abc.public.blob.vercel-storage.com/recoletos/foto-1.webp';
const UUID = '3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c';

describe('parseEmail', () => {
  it('trims and lowercases', () => {
    expect(parseEmail('  Ana@Example.ORG ')).toEqual({ ok: true, value: 'ana@example.org' });
  });

  it.each(['', 'sin-arroba', 'a@b', 'a b@c.d', null, undefined, `${'x'.repeat(250)}@a.org`])('rejects %s', (raw) => {
    expect(parseEmail(raw).ok).toBe(false);
  });
});

describe('parseAppearance', () => {
  const valid = {
    name: 'Recoletos',
    hero_title: 'Ayúdanos',
    hero_text: 'Uno\r\n\r\nDos',
    primary_color: '#007986',
    hero_image_url: '',
    logo_url: '',
  };

  it('accepts a valid form and normalizes line endings', () => {
    expect(parseAppearance(form(valid), 'recoletos')).toEqual({
      ok: true,
      value: {
        name: 'Recoletos',
        heroTitle: 'Ayúdanos',
        heroText: 'Uno\n\nDos',
        primaryColor: '#007986',
        heroImageUrl: null,
        logoUrl: null,
      },
    });
  });

  it('keeps an uploaded image URL from this center', () => {
    const result = parseAppearance(form({ ...valid, hero_image_url: BLOB }), 'recoletos');
    expect(result.ok && result.value.heroImageUrl).toBe(BLOB);
  });

  it.each([
    ['empty name', { name: ' ' }],
    ['long name', { name: 'x'.repeat(81) }],
    ['low contrast color', { primary_color: '#ffeb3b' }],
    ['css injection in color', { primary_color: '#007986;background:url(//evil)' }],
    ['foreign image', { hero_image_url: 'https://evil.example.com/a.png' }],
    ['other center image', { logo_url: 'https://abc.public.blob.vercel-storage.com/otro/a.webp' }],
    ['long text', { hero_text: 'x'.repeat(4001) }],
  ])('rejects %s', (_label, override) => {
    expect(parseAppearance(form({ ...valid, ...override }), 'recoletos').ok).toBe(false);
  });
});

describe('parseItem', () => {
  const valid = { name: 'Cáliz', description: 'Dorado', goal: '120,50', status: 'active', sort_order: '2', image_url: '', image_alt: '' };

  it('accepts a valid item and reads a comma decimal', () => {
    expect(parseItem(form(valid), 'recoletos')).toEqual({
      ok: true,
      value: { name: 'Cáliz', description: 'Dorado', goal: 120.5, status: 'active', sortOrder: 2, imageUrl: null, imageAlt: null },
    });
  });

  it('defaults the sort order to 0', () => {
    const result = parseItem(form({ ...valid, sort_order: '' }), 'recoletos');
    expect(result.ok && result.value.sortOrder).toBe(0);
  });

  it.each([
    ['empty name', { name: '' }],
    ['zero goal', { goal: '0' }],
    ['negative goal', { goal: '-5' }],
    ['exponent goal', { goal: '1e9' }],
    ['three decimals', { goal: '10.123' }],
    ['text goal', { goal: 'mucho' }],
    ['goal over one million', { goal: '10000000' }],
    ['archived status', { status: 'archived' }],
    ['unknown status', { status: 'funded' }],
    ['fractional sort order', { sort_order: '1.5' }],
    ['foreign image', { image_url: 'https://evil.example.com/a.png' }],
  ])('rejects %s', (_label, override) => {
    expect(parseItem(form({ ...valid, ...override }), 'recoletos').ok).toBe(false);
  });
});

describe('parseManualDonation', () => {
  it('accepts a valid donation', () => {
    expect(parseManualDonation(form({ item_id: UUID, amount: '25', note: 'efectivo' }))).toEqual({
      ok: true,
      value: { itemId: UUID, amount: 25, note: 'efectivo' },
    });
  });

  it.each([
    { item_id: '1', amount: '25' },
    { item_id: UUID, amount: '0' },
    { item_id: UUID, amount: '-3' },
    { item_id: UUID, amount: 'NaN' },
    { item_id: UUID, amount: '25', note: 'x'.repeat(201) },
  ])('rejects %j', (fields) => {
    expect(parseManualDonation(form(fields)).ok).toBe(false);
  });
});

describe('parsePaypal', () => {
  const clientId = 'AbCdEfGhIjKlMnOpQrSt';

  it('keeps a blank secret as null', () => {
    expect(parsePaypal(form({ client_id: clientId, env: 'live', secret: '' }))).toEqual({
      ok: true,
      value: { clientId, env: 'live', secret: null },
    });
  });

  it('returns a provided secret', () => {
    const result = parsePaypal(form({ client_id: clientId, env: 'sandbox', secret: 'EXAMPLE-SECRET' }));
    expect(result.ok && result.value.secret).toBe('EXAMPLE-SECRET');
  });

  it.each([
    { client_id: 'short', env: 'live' },
    { client_id: `${clientId} x`, env: 'live' },
    { client_id: clientId, env: 'production' },
    { client_id: clientId, env: 'live', secret: 'con espacios' },
  ])('rejects %j', (fields) => {
    expect(parsePaypal(form(fields)).ok).toBe(false);
  });
});

describe('parseNewCenter', () => {
  it('lowercases the slug and validates it', () => {
    expect(parseNewCenter(form({ slug: 'Colegio-Norte', name: 'Colegio Norte' }))).toEqual({
      ok: true,
      value: { slug: 'colegio-norte', name: 'Colegio Norte' },
    });
  });

  it.each([
    { slug: 'admin', name: 'x' },
    { slug: 'con espacio', name: 'x' },
    { slug: 'valido', name: '' },
  ])('rejects %j', (fields) => {
    expect(parseNewCenter(form(fields)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/admin/forms.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/admin/forms.ts`**

```ts
import { isCenterBlobUrl } from '../blob';
import { isValidPrimaryColor } from '../color';
import { isUuid } from '../ids';
import { validateSlug } from '../slug';
import type { AppearanceInput, ItemInput, PayPalEnv } from '../../types/database';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PayPalFormInput {
  clientId: string;
  env: PayPalEnv;
  secret: string | null;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

const MONEY_PATTERN = /^\d{1,7}([.,]\d{1,2})?$/;
const INTEGER_PATTERN = /^-?\d{1,6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYPAL_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_AMOUNT = 1_000_000;

function parseMoney(raw: string): number | null {
  if (!MONEY_PATTERN.test(raw)) return null;
  const value = Number(raw.replace(',', '.'));
  return value > 0 && value <= MAX_AMOUNT ? value : null;
}

function blobField(form: FormData, name: string, slug: string): { ok: true; value: string | null } | { ok: false } {
  const raw = text(form, name);
  if (raw === '') return { ok: true, value: null };
  return isCenterBlobUrl(raw, slug) ? { ok: true, value: raw } : { ok: false };
}

export function parseEmail(raw: unknown): Parsed<string> {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return fail('Introduce un correo electrónico válido');
  }
  return { ok: true, value: email };
}

export function parseAppearance(form: FormData, slug: string): Parsed<AppearanceInput> {
  const name = text(form, 'name');
  if (!name || name.length > 80) return fail('El nombre es obligatorio (máximo 80 caracteres)');

  const heroTitle = text(form, 'hero_title');
  if (heroTitle.length > 200) return fail('El título admite como máximo 200 caracteres');

  const heroText = text(form, 'hero_text').replace(/\r\n/g, '\n');
  if (heroText.length > 4000) return fail('El texto admite como máximo 4000 caracteres');

  const primaryColor = text(form, 'primary_color').toLowerCase();
  if (!isValidPrimaryColor(primaryColor)) {
    return fail('El color no tiene suficiente contraste con el texto blanco');
  }

  const heroImage = blobField(form, 'hero_image_url', slug);
  const logo = blobField(form, 'logo_url', slug);
  if (!heroImage.ok || !logo.ok) return fail('La imagen no es válida, súbela de nuevo');

  return {
    ok: true,
    value: { name, heroTitle, heroText, primaryColor, heroImageUrl: heroImage.value, logoUrl: logo.value },
  };
}

export function parseItem(form: FormData, slug: string): Parsed<ItemInput> {
  const name = text(form, 'name');
  if (!name || name.length > 120) return fail('El nombre es obligatorio (máximo 120 caracteres)');

  const description = text(form, 'description').replace(/\r\n/g, '\n');
  if (description.length > 2000) return fail('La descripción admite como máximo 2000 caracteres');

  const goal = parseMoney(text(form, 'goal'));
  if (goal === null) return fail('El precio debe ser un importe positivo con hasta 2 decimales');

  const status = text(form, 'status');
  if (status !== 'draft' && status !== 'active') return fail('El estado no es válido');

  const sortRaw = text(form, 'sort_order');
  if (sortRaw !== '' && !INTEGER_PATTERN.test(sortRaw)) return fail('El orden debe ser un número entero');

  const image = blobField(form, 'image_url', slug);
  if (!image.ok) return fail('La imagen no es válida, súbela de nuevo');

  const imageAlt = text(form, 'image_alt');
  if (imageAlt.length > 200) return fail('El texto alternativo admite como máximo 200 caracteres');

  return {
    ok: true,
    value: {
      name,
      description,
      goal,
      status,
      sortOrder: sortRaw === '' ? 0 : Number(sortRaw),
      imageUrl: image.value,
      imageAlt: imageAlt || null,
    },
  };
}

export function parseManualDonation(form: FormData): Parsed<{ itemId: string; amount: number; note: string }> {
  const itemId = text(form, 'item_id');
  if (!isUuid(itemId)) return fail('Elige un artículo');

  const amount = parseMoney(text(form, 'amount'));
  if (amount === null) return fail('El importe debe ser positivo con hasta 2 decimales');

  const note = text(form, 'note');
  if (note.length > 200) return fail('La nota admite como máximo 200 caracteres');

  return { ok: true, value: { itemId, amount, note } };
}

export function parsePaypal(form: FormData): Parsed<PayPalFormInput> {
  const clientId = text(form, 'client_id');
  if (!PAYPAL_CLIENT_ID_PATTERN.test(clientId)) return fail('El Client ID de PayPal no es válido');

  const env = text(form, 'env');
  if (env !== 'sandbox' && env !== 'live') return fail('El entorno de PayPal no es válido');

  const secret = text(form, 'secret');
  if (secret !== '' && !/^\S{1,300}$/.test(secret)) return fail('El secret de PayPal no es válido');

  return { ok: true, value: { clientId, env, secret: secret === '' ? null : secret } };
}

export function parseNewCenter(form: FormData): Parsed<{ slug: string; name: string }> {
  const slug = text(form, 'slug').toLowerCase();
  const slugError = validateSlug(slug);
  if (slugError) return fail(slugError);

  const name = text(form, 'name');
  if (!name || name.length > 80) return fail('El nombre es obligatorio (máximo 80 caracteres)');

  return { ok: true, value: { slug, name } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/admin/forms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (ask Gloria first)**

```bash
git add src/lib/admin src/tests/admin
git commit -m "feat(admin): add strict form parsing for center administration"
```

---

### Task 14: Admin layout, image upload and appearance page

**Files:**
- Create: `src/components/admin/ui.ts`, `src/layouts/AdminLayout.astro`, `src/components/admin/ImageUpload.astro`, `src/pages/api/[slug]/upload.ts`, `src/pages/[slug]/admin/index.astro`
- Test: `src/tests/api/upload.test.ts`

**Interfaces:**
- Consumes: `guardCenter` (T11), `authorizeCenter`/`getActor` (T11), `parseAppearance` (T13), `updateAppearance` (T5), `listMembershipsByEmail` (T5).
- Produces:
  - `ui.ts` exports `inputClass`, `labelClass`, `buttonClass`, `dangerButtonClass`, `cardClass` (strings).
  - `AdminLayout` props `{ title: string; actor: Actor; center?: Center; active?: 'appearance' | 'items' | 'donations' | 'users' | 'centers' }`; shows `?ok=` as "Cambios guardados" and `?error=` text.
  - `ImageUpload` props `{ slug: string; name: string; label: string; current?: string | null }`; the hidden input `name` receives the uploaded blob URL.
  - `POST /api/<slug>/upload` (Vercel Blob client-upload handshake).

- [ ] **Step 1: Write the failing upload test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleUpload, authorizeCenter, getActor } = vi.hoisted(() => ({
  handleUpload: vi.fn(),
  authorizeCenter: vi.fn(),
  getActor: vi.fn(),
}));

vi.mock('@vercel/blob/client', () => ({ handleUpload }));
vi.mock('../../lib/auth/access', () => ({ authorizeCenter, getActor }));

import { POST } from '../../pages/api/[slug]/upload';

const call = (slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ type: 'blob.generate-client-token' }) }),
    params: { slug },
    cookies: {},
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getActor.mockResolvedValue({ email: 'ana@example.org', uid: 'u1', isSuperadmin: false });
  authorizeCenter.mockResolvedValue({ ok: true, center: { slug: 'recoletos' } });
  handleUpload.mockResolvedValue({ type: 'blob.generate-client-token', clientToken: 'tok' });
});

describe('POST /api/[slug]/upload', () => {
  it.each([401, 403, 404])('passes through the authorization status %s', async (status) => {
    authorizeCenter.mockResolvedValue({ ok: false, status });
    expect((await call()).status).toBe(status);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it('returns the handshake result for an authorized manager', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 'blob.generate-client-token', clientToken: 'tok' });
  });

  it('only issues tokens for paths under the center prefix, with strict type and size limits', async () => {
    await call();
    const { onBeforeGenerateToken } = handleUpload.mock.calls[0][0];
    await expect(onBeforeGenerateToken('otro/foto.webp')).rejects.toThrow();
    await expect(onBeforeGenerateToken('../recoletos/foto.webp')).rejects.toThrow();
    expect(await onBeforeGenerateToken('recoletos/foto.webp')).toEqual({
      allowedContentTypes: ['image/webp', 'image/jpeg', 'image/png'],
      maximumSizeInBytes: 5 * 1024 * 1024,
      addRandomSuffix: true,
    });
  });

  it('returns 400 when the handshake fails', async () => {
    handleUpload.mockRejectedValue(new Error('bad'));
    expect((await call()).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/api/upload.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/pages/api/[slug]/upload.ts`**

```ts
import type { APIRoute } from 'astro';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authorizeCenter, getActor } from '../../../lib/auth/access';

const ALLOWED_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params, cookies }) => {
  const access = await authorizeCenter(await getActor(cookies), params.slug ?? '');
  if (!access.ok) return new Response(null, { status: access.status });

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`${access.center.slug}/`) || pathname.includes('..')) {
          throw new Error('Invalid upload path');
        }
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
    });
    return json(result);
  } catch {
    return json({ error: 'No se pudo preparar la subida' }, 400);
  }
};
```

If `pnpm exec astro check` reports that `onUploadCompleted` is required by the installed `@vercel/blob` version, add `onUploadCompleted: async () => {},` to the options; the completion webhook then returns 401 to Vercel (it has no session), which is harmless because nothing depends on it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/api/upload.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/components/admin/ui.ts`**

```ts
export const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600';
export const labelClass = 'block text-sm font-medium text-gray-900 mb-1';
export const buttonClass =
  'inline-flex items-center rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-50';
export const dangerButtonClass =
  'inline-flex items-center rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50';
export const cardClass = 'rounded-xl border border-gray-200 bg-white p-6 shadow-sm';
```

- [ ] **Step 6: Create `src/layouts/AdminLayout.astro`**

```astro
---
import "../styles/global.css";
import type { Actor } from "../lib/auth/access";
import { listMembershipsByEmail } from "../lib/repo/users";
import type { Center } from "../types/database";

interface Props {
  title: string;
  actor: Actor;
  center?: Center;
  active?: 'appearance' | 'items' | 'donations' | 'users' | 'centers';
}

const { title, actor, center, active } = Astro.props;
const ok = Astro.url.searchParams.get('ok');
const error = Astro.url.searchParams.get('error');
const memberships = actor.isSuperadmin ? [] : await listMembershipsByEmail(actor.email);
const base = center ? `/${center.slug}/admin` : '/admin';
const nav = center
  ? [
      { key: 'appearance', label: 'Apariencia', href: base },
      { key: 'items', label: 'Artículos', href: `${base}/items` },
      { key: 'donations', label: 'Donaciones', href: `${base}/donations` },
      { key: 'users', label: 'Usuarios', href: `${base}/users` },
    ]
  : [{ key: 'centers', label: 'Centros', href: '/admin' }];
---

<html lang="es">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/webp" href="/favicon.webp" />
    <meta name="viewport" content="width=device-width" />
    <meta name="robots" content="noindex" />
    <title>{title} - Panel</title>
  </head>
  <body class="antialiased">
    <header class="border-b border-gray-200 bg-white">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Panel</p>
          <p class="text-lg font-semibold text-gray-900">{center ? center.name : 'Administración'}</p>
        </div>
        <nav class="flex flex-wrap items-center gap-4 text-sm">
          {nav.map((entry) => (
            <a href={entry.href} class={entry.key === active ? 'font-semibold text-teal-700' : 'text-gray-600 hover:text-gray-900'}>
              {entry.label}
            </a>
          ))}
          {center && <a href={`/${center.slug}`} class="text-gray-600 hover:text-gray-900">Ver mi web</a>}
          {actor.isSuperadmin && center && <a href="/admin" class="text-gray-600 hover:text-gray-900">Todos los centros</a>}
          {memberships.length > 1 && memberships.map((m) => (
            <a href={`/${m.slug}/admin`} class="text-gray-600 hover:text-gray-900">{m.name}</a>
          ))}
          <form method="post" action="/api/auth/logout">
            <button type="submit" class="text-gray-600 hover:text-gray-900">Salir</button>
          </form>
        </nav>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <h1 class="text-2xl font-bold text-gray-900">{title}</h1>
      {ok && <p class="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Cambios guardados</p>}
      {error && <p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 7: Create `src/components/admin/ImageUpload.astro`**

```astro
---
import { labelClass } from "./ui";

interface Props {
  slug: string;
  name: string;
  label: string;
  current?: string | null;
}

const { slug, name, label, current = null } = Astro.props;
const inputId = `upload-${name}`;
---

<div class="space-y-2" data-upload data-slug={slug}>
  <label class={labelClass} for={inputId}>{label}</label>
  {current && <img src={current} alt="" class="h-24 rounded border border-gray-200 object-cover" />}
  <input id={inputId} type="file" accept="image/webp,image/jpeg,image/png" class="block text-sm" />
  <input type="hidden" name={name} value="" />
  <p class="text-xs text-gray-600" data-status hidden></p>
</div>

<script>
  import { upload } from '@vercel/blob/client';

  document.querySelectorAll<HTMLElement>('[data-upload]').forEach((root) => {
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    const hidden = root.querySelector<HTMLInputElement>('input[type="hidden"]')!;
    const status = root.querySelector<HTMLElement>('[data-status]')!;
    const slug = root.dataset.slug!;
    const submitButtons = () =>
      Array.from(file.form?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') ?? []);

    file.addEventListener('change', async () => {
      const selected = file.files?.[0];
      if (!selected) return;

      status.hidden = false;
      status.textContent = 'Subiendo imagen...';
      submitButtons().forEach((button) => (button.disabled = true));

      try {
        const safeName = selected.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const blob = await upload(`${slug}/${crypto.randomUUID()}-${safeName}`, selected, {
          access: 'public',
          handleUploadUrl: `/api/${slug}/upload`,
        });
        hidden.value = blob.url;
        status.textContent = 'Imagen subida. Guarda los cambios para aplicarla.';
      } catch {
        hidden.value = '';
        status.textContent = 'No se pudo subir la imagen (webp, jpg o png, máximo 5 MB).';
      } finally {
        submitButtons().forEach((button) => (button.disabled = false));
      }
    });
  });
</script>
```

- [ ] **Step 8: Create `src/pages/[slug]/admin/index.astro`** (appearance)

```astro
---
import AdminLayout from "../../../layouts/AdminLayout.astro";
import ImageUpload from "../../../components/admin/ImageUpload.astro";
import { buttonClass, cardClass, inputClass, labelClass } from "../../../components/admin/ui";
import { parseAppearance } from "../../../lib/admin/forms";
import { guardCenter } from "../../../lib/auth/guard";
import { updateAppearance } from "../../../lib/repo/centers";

const guard = await guardCenter(Astro);
if (guard instanceof Response) return guard;
const { actor, center } = guard;
const here = `/${center.slug}/admin`;

if (Astro.request.method === 'POST') {
  const parsed = parseAppearance(await Astro.request.formData(), center.slug);
  if (!parsed.ok) return Astro.redirect(`${here}?error=${encodeURIComponent(parsed.error)}`, 303);
  await updateAppearance(center.id, parsed.value);
  return Astro.redirect(`${here}?ok=1`, 303);
}
---

<AdminLayout title="Apariencia" actor={actor} center={center} active="appearance">
  <form method="post" class={`${cardClass} space-y-6`}>
    <div>
      <label class={labelClass} for="name">Nombre del centro</label>
      <input id="name" name="name" class={inputClass} value={center.name} maxlength="80" required />
    </div>
    <div>
      <label class={labelClass} for="hero_title">Título de la portada</label>
      <input id="hero_title" name="hero_title" class={inputClass} value={center.hero_title} maxlength="200" />
    </div>
    <div>
      <label class={labelClass} for="hero_text">Texto de presentación</label>
      <textarea id="hero_text" name="hero_text" class={inputClass} rows="8" maxlength="4000">{center.hero_text}</textarea>
      <p class="mt-1 text-xs text-gray-500">Separa los párrafos con una línea en blanco.</p>
    </div>
    <div>
      <label class={labelClass} for="primary_color">Color principal</label>
      <input id="primary_color" name="primary_color" type="color" value={center.primary_color} class="h-10 w-20 rounded border border-gray-300" />
      <p class="mt-1 text-xs text-gray-500">Debe contrastar con el texto blanco; si es demasiado claro no se guardará.</p>
    </div>
    <ImageUpload slug={center.slug} name="hero_image_url" label="Imagen de portada" current={center.hero_image_url} />
    <ImageUpload slug={center.slug} name="logo_url" label="Logo" current={center.logo_url} />
    <button type="submit" class={buttonClass}>Guardar cambios</button>
  </form>
</AdminLayout>
```

- [ ] **Step 9: Verify**

Run: `pnpm exec vitest run && pnpm exec astro check`
Expected: PASS; no new `astro check` errors (resolve any `@vercel/blob` typing note as described in Step 3).

- [ ] **Step 10: Commit (ask Gloria first)**

```bash
git add src/components/admin src/layouts/AdminLayout.astro src/pages/api/[slug]/upload.ts src/pages/[slug]/admin/index.astro src/tests/api/upload.test.ts
git commit -m "feat(admin): add admin layout, image upload and appearance page"
```

---

### Task 15: Items administration

**Files:**
- Create: `src/pages/[slug]/admin/items/index.astro`, `src/pages/[slug]/admin/items/[id].astro`

**Interfaces:**
- Consumes: `listAdminItems`, `getAdminItem`, `createItem`, `updateItem`, `removeOrArchiveItem` (T5); `parseItem` (T13); `guardCenter` (T11); `isUuid` (T3); `ImageUpload`, `ui` (T14).
- Produces: `/<slug>/admin/items` (list + create) and `/<slug>/admin/items/<id>` (edit, remove/archive).

- [ ] **Step 1: Create `src/pages/[slug]/admin/items/index.astro`**

```astro
---
import AdminLayout from "../../../../layouts/AdminLayout.astro";
import ImageUpload from "../../../../components/admin/ImageUpload.astro";
import { buttonClass, cardClass, inputClass, labelClass } from "../../../../components/admin/ui";
import { parseItem } from "../../../../lib/admin/forms";
import { guardCenter } from "../../../../lib/auth/guard";
import { createItem, listAdminItems } from "../../../../lib/repo/items";

const guard = await guardCenter(Astro);
if (guard instanceof Response) return guard;
const { actor, center } = guard;
const here = `/${center.slug}/admin/items`;

if (Astro.request.method === 'POST') {
  const parsed = parseItem(await Astro.request.formData(), center.slug);
  if (!parsed.ok) return Astro.redirect(`${here}?error=${encodeURIComponent(parsed.error)}`, 303);
  await createItem(center.id, parsed.value);
  return Astro.redirect(`${here}?ok=1`, 303);
}

const items = await listAdminItems(center.id);

const statusLabel = (status: string, raised: number, goal: number) => {
  if (status === 'archived') return 'Archivado';
  if (status === 'draft') return 'Borrador';
  return raised >= goal ? 'Financiado' : 'Activo';
};
---

<AdminLayout title="Artículos" actor={actor} center={center} active="items">
  <div class={`${cardClass} overflow-x-auto`}>
    {items.length === 0 ? (
      <p class="text-gray-500">Todavía no hay artículos. Crea el primero con el formulario de abajo.</p>
    ) : (
      <table class="w-full text-left text-sm">
        <thead class="text-xs uppercase text-gray-500">
          <tr>
            <th class="py-2 pr-4">Artículo</th>
            <th class="py-2 pr-4">Recaudado / Precio</th>
            <th class="py-2 pr-4">Estado</th>
            <th class="py-2 pr-4">Orden</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {items.map((item) => (
            <tr>
              <td class="py-3 pr-4 font-medium text-gray-900">{item.name}</td>
              <td class="py-3 pr-4">{item.raised.toFixed(2)} € / {item.goal.toFixed(2)} €</td>
              <td class="py-3 pr-4">{statusLabel(item.status, item.raised, item.goal)}</td>
              <td class="py-3 pr-4">{item.sortOrder}</td>
              <td class="py-3 text-right">
                <a href={`${here}/${item.id}`} class="text-teal-700 hover:underline">Editar</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>

  <form method="post" class={`${cardClass} space-y-4`}>
    <h2 class="text-lg font-semibold text-gray-900">Nuevo artículo</h2>
    <div>
      <label class={labelClass} for="name">Nombre</label>
      <input id="name" name="name" class={inputClass} maxlength="120" required />
    </div>
    <div>
      <label class={labelClass} for="description">Descripción</label>
      <textarea id="description" name="description" class={inputClass} rows="4" maxlength="2000"></textarea>
    </div>
    <div class="grid gap-4 sm:grid-cols-3">
      <div>
        <label class={labelClass} for="goal">Precio (€)</label>
        <input id="goal" name="goal" class={inputClass} inputmode="decimal" required />
      </div>
      <div>
        <label class={labelClass} for="status">Estado</label>
        <select id="status" name="status" class={inputClass}>
          <option value="active">Activo (visible)</option>
          <option value="draft">Borrador (oculto)</option>
        </select>
      </div>
      <div>
        <label class={labelClass} for="sort_order">Orden</label>
        <input id="sort_order" name="sort_order" class={inputClass} inputmode="numeric" value="0" />
      </div>
    </div>
    <ImageUpload slug={center.slug} name="image_url" label="Imagen" />
    <div>
      <label class={labelClass} for="image_alt">Texto alternativo de la imagen</label>
      <input id="image_alt" name="image_alt" class={inputClass} maxlength="200" />
    </div>
    <button type="submit" class={buttonClass}>Crear artículo</button>
  </form>
</AdminLayout>
```

- [ ] **Step 2: Create `src/pages/[slug]/admin/items/[id].astro`**

```astro
---
import AdminLayout from "../../../../layouts/AdminLayout.astro";
import ImageUpload from "../../../../components/admin/ImageUpload.astro";
import { buttonClass, cardClass, dangerButtonClass, inputClass, labelClass } from "../../../../components/admin/ui";
import { parseItem } from "../../../../lib/admin/forms";
import { guardCenter } from "../../../../lib/auth/guard";
import { isUuid } from "../../../../lib/ids";
import { getAdminItem, removeOrArchiveItem, updateItem } from "../../../../lib/repo/items";

const guard = await guardCenter(Astro);
if (guard instanceof Response) return guard;
const { actor, center } = guard;
const listUrl = `/${center.slug}/admin/items`;

const { id } = Astro.params;
if (!isUuid(id)) return new Response('Artículo no encontrado', { status: 404 });

const item = await getAdminItem(center.id, id);
if (!item) return new Response('Artículo no encontrado', { status: 404 });

if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData();
  const here = `${listUrl}/${item.id}`;

  if (form.get('intent') === 'remove') {
    const outcome = await removeOrArchiveItem(center.id, item.id);
    const message = outcome === 'archived' ? 'El artículo tiene donaciones, se ha archivado en lugar de borrarlo' : '';
    return Astro.redirect(message ? `${listUrl}?error=${encodeURIComponent(message)}` : `${listUrl}?ok=1`, 303);
  }

  const parsed = parseItem(form, center.slug);
  if (!parsed.ok) return Astro.redirect(`${here}?error=${encodeURIComponent(parsed.error)}`, 303);
  await updateItem(center.id, item.id, parsed.value);
  return Astro.redirect(`${here}?ok=1`, 303);
}
---

<AdminLayout title={item.name} actor={actor} center={center} active="items">
  <p class="text-sm text-gray-600">
    <a href={listUrl} class="text-teal-700 hover:underline">← Volver a los artículos</a>
    · Recaudado {item.raised.toFixed(2)} € de {item.goal.toFixed(2)} € · {item.donationCount} donaciones
  </p>

  {item.status === 'archived' && (
    <p class="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
      Este artículo está archivado. Guárdalo con estado "Activo" para volver a mostrarlo.
    </p>
  )}

  <form method="post" class={`${cardClass} space-y-4`}>
    <div>
      <label class={labelClass} for="name">Nombre</label>
      <input id="name" name="name" class={inputClass} value={item.name} maxlength="120" required />
    </div>
    <div>
      <label class={labelClass} for="description">Descripción</label>
      <textarea id="description" name="description" class={inputClass} rows="4" maxlength="2000">{item.description}</textarea>
    </div>
    <div class="grid gap-4 sm:grid-cols-3">
      <div>
        <label class={labelClass} for="goal">Precio (€)</label>
        <input id="goal" name="goal" class={inputClass} inputmode="decimal" value={item.goal.toFixed(2)} required />
      </div>
      <div>
        <label class={labelClass} for="status">Estado</label>
        <select id="status" name="status" class={inputClass}>
          <option value="active" selected={item.status === 'active' || item.status === 'funded' || item.status === 'archived'}>Activo (visible)</option>
          <option value="draft" selected={item.status === 'draft'}>Borrador (oculto)</option>
        </select>
      </div>
      <div>
        <label class={labelClass} for="sort_order">Orden</label>
        <input id="sort_order" name="sort_order" class={inputClass} inputmode="numeric" value={String(item.sortOrder)} />
      </div>
    </div>
    <ImageUpload slug={center.slug} name="image_url" label="Cambiar imagen" current={item.imageUrl} />
    <div>
      <label class={labelClass} for="image_alt">Texto alternativo de la imagen</label>
      <input id="image_alt" name="image_alt" class={inputClass} value={item.imageAlt ?? ''} maxlength="200" />
    </div>
    <button type="submit" class={buttonClass}>Guardar cambios</button>
  </form>

  <form method="post" class={`${cardClass} flex items-center justify-between gap-4`}>
    <input type="hidden" name="intent" value="remove" />
    <p class="text-sm text-gray-600">
      {item.donationCount > 0
        ? 'Este artículo tiene donaciones: se archivará para conservar el registro.'
        : 'Este artículo no tiene donaciones: se borrará definitivamente.'}
    </p>
    <button type="submit" class={dangerButtonClass}>{item.donationCount > 0 ? 'Archivar' : 'Borrar'}</button>
  </form>
</AdminLayout>
```

- [ ] **Step 3: Verify**

Run: `pnpm exec vitest run && pnpm exec astro check && pnpm run build`
Expected: PASS; build succeeds. (Behaviour is covered by Task 13 form tests, Task 6 SQL tests and the manual smoke test in Task 20.)

- [ ] **Step 4: Commit (ask Gloria first)**

```bash
git add src/pages/[slug]/admin/items
git commit -m "feat(admin): manage wish list items per center"
```

---

### Task 16: Donations administration

**Files:**
- Create: `src/pages/[slug]/admin/donations.astro`

**Interfaces:**
- Consumes: `listDonations`, `addManualDonation`, `voidManualDonation` (T5); `listAdminItems` (T5); `parseManualDonation` (T13); `guardCenter` (T11); `isUuid` (T3).
- Produces: `/<slug>/admin/donations` (ledger, add manual donation, void manual donation).

- [ ] **Step 1: Create `src/pages/[slug]/admin/donations.astro`**

```astro
---
import AdminLayout from "../../../layouts/AdminLayout.astro";
import { buttonClass, cardClass, dangerButtonClass, inputClass, labelClass } from "../../../components/admin/ui";
import { parseManualDonation } from "../../../lib/admin/forms";
import { guardCenter } from "../../../lib/auth/guard";
import { isUuid } from "../../../lib/ids";
import { addManualDonation, listDonations, voidManualDonation } from "../../../lib/repo/donations";
import { listAdminItems } from "../../../lib/repo/items";

const guard = await guardCenter(Astro);
if (guard instanceof Response) return guard;
const { actor, center } = guard;
const here = `/${center.slug}/admin/donations`;
const fail = (message: string) => Astro.redirect(`${here}?error=${encodeURIComponent(message)}`, 303);

if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData();

  if (form.get('intent') === 'void') {
    const donationId = String(form.get('donation_id') ?? '');
    if (!isUuid(donationId) || !(await voidManualDonation(center.id, donationId))) {
      return fail('No se pudo anular la donación');
    }
    return Astro.redirect(`${here}?ok=1`, 303);
  }

  const parsed = parseManualDonation(form);
  if (!parsed.ok) return fail(parsed.error);
  const created = await addManualDonation({ centerId: center.id, ...parsed.value });
  if (!created) return fail('El artículo no existe en este centro');
  return Astro.redirect(`${here}?ok=1`, 303);
}

const [donations, items] = await Promise.all([listDonations(center.id), listAdminItems(center.id)]);
const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });
---

<AdminLayout title="Donaciones" actor={actor} center={center} active="donations">
  <form method="post" class={`${cardClass} space-y-4`}>
    <h2 class="text-lg font-semibold text-gray-900">Añadir donación manual</h2>
    <p class="text-sm text-gray-600">Para donaciones recibidas fuera de PayPal (efectivo, transferencia...).</p>
    <div class="grid gap-4 sm:grid-cols-3">
      <div>
        <label class={labelClass} for="item_id">Artículo</label>
        <select id="item_id" name="item_id" class={inputClass} required>
          {items.filter((item) => item.status !== 'archived').map((item) => (
            <option value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label class={labelClass} for="amount">Importe (€)</label>
        <input id="amount" name="amount" class={inputClass} inputmode="decimal" required />
      </div>
      <div>
        <label class={labelClass} for="note">Nota</label>
        <input id="note" name="note" class={inputClass} maxlength="200" />
      </div>
    </div>
    <button type="submit" class={buttonClass}>Añadir donación</button>
  </form>

  <div class={`${cardClass} overflow-x-auto`}>
    {donations.length === 0 ? (
      <p class="text-gray-500">Todavía no hay donaciones.</p>
    ) : (
      <table class="w-full text-left text-sm">
        <thead class="text-xs uppercase text-gray-500">
          <tr>
            <th class="py-2 pr-4">Fecha</th>
            <th class="py-2 pr-4">Artículo</th>
            <th class="py-2 pr-4">Importe</th>
            <th class="py-2 pr-4">Origen</th>
            <th class="py-2 pr-4">Nota</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {donations.map((donation) => (
            <tr class={donation.voided_at ? 'text-gray-400 line-through' : ''}>
              <td class="py-3 pr-4">{date.format(new Date(donation.created_at))}</td>
              <td class="py-3 pr-4">{donation.item_name}</td>
              <td class="py-3 pr-4">{Number(donation.amount).toFixed(2)} {donation.currency}</td>
              <td class="py-3 pr-4">{donation.source === 'paypal' ? 'PayPal' : 'Manual'}</td>
              <td class="py-3 pr-4">{donation.note ?? ''}</td>
              <td class="py-3 text-right">
                {donation.source === 'manual' && !donation.voided_at && (
                  <form method="post">
                    <input type="hidden" name="intent" value="void" />
                    <input type="hidden" name="donation_id" value={donation.id} />
                    <button type="submit" class={dangerButtonClass}>Anular</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
</AdminLayout>
```

- [ ] **Step 2: Verify**

Run: `pnpm exec astro check && pnpm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 3: Commit (ask Gloria first)**

```bash
git add src/pages/[slug]/admin/donations.astro
git commit -m "feat(admin): list, add and void donations"
```

---

### Task 17: Managers administration

**Files:**
- Create: `src/pages/[slug]/admin/users.astro`

**Interfaces:**
- Consumes: `listCenterUsers`, `addCenterUser`, `removeCenterUser` (T5); `parseEmail` (T13); `guardCenter` (T11).
- Produces: `/<slug>/admin/users`. Non-superadmins cannot remove the last manager; the superadmin passes `{ force: true }`.

- [ ] **Step 1: Create `src/pages/[slug]/admin/users.astro`**

```astro
---
import AdminLayout from "../../../layouts/AdminLayout.astro";
import { buttonClass, cardClass, dangerButtonClass, inputClass, labelClass } from "../../../components/admin/ui";
import { parseEmail } from "../../../lib/admin/forms";
import { guardCenter } from "../../../lib/auth/guard";
import { addCenterUser, listCenterUsers, removeCenterUser } from "../../../lib/repo/users";

const guard = await guardCenter(Astro);
if (guard instanceof Response) return guard;
const { actor, center } = guard;
const here = `/${center.slug}/admin/users`;
const fail = (message: string) => Astro.redirect(`${here}?error=${encodeURIComponent(message)}`, 303);

if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData();
  const parsed = parseEmail(form.get('email'));
  if (!parsed.ok) return fail(parsed.error);

  if (form.get('intent') === 'remove') {
    const outcome = await removeCenterUser(center.id, parsed.value, { force: actor.isSuperadmin });
    if (outcome === 'last') return fail('No se puede quitar al último encargado del centro');
    if (outcome === 'missing') return fail('Ese correo no es encargado de este centro');
    return Astro.redirect(`${here}?ok=1`, 303);
  }

  await addCenterUser(center.id, parsed.value);
  return Astro.redirect(`${here}?ok=1`, 303);
}

const users = await listCenterUsers(center.id);
---

<AdminLayout title="Usuarios" actor={actor} center={center} active="users">
  <form method="post" class={`${cardClass} space-y-4`}>
    <h2 class="text-lg font-semibold text-gray-900">Añadir encargado</h2>
    <p class="text-sm text-gray-600">Podrá entrar con la cuenta de Google de este correo.</p>
    <div>
      <label class={labelClass} for="email">Correo de Google</label>
      <input id="email" name="email" type="email" class={inputClass} required />
    </div>
    <button type="submit" class={buttonClass}>Añadir</button>
  </form>

  <div class={`${cardClass} overflow-x-auto`}>
    <table class="w-full text-left text-sm">
      <thead class="text-xs uppercase text-gray-500">
        <tr>
          <th class="py-2 pr-4">Correo</th>
          <th class="py-2 pr-4">Estado</th>
          <th class="py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        {users.map((user) => (
          <tr>
            <td class="py-3 pr-4 font-medium text-gray-900">{user.email}</td>
            <td class="py-3 pr-4">{user.firebase_uid ? 'Ha entrado' : 'Pendiente de primer acceso'}</td>
            <td class="py-3 text-right">
              <form method="post">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="email" value={user.email} />
                <button type="submit" class={dangerButtonClass}>Quitar</button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</AdminLayout>
```

- [ ] **Step 2: Verify**

Run: `pnpm exec astro check && pnpm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 3: Commit (ask Gloria first)**

```bash
git add src/pages/[slug]/admin/users.astro
git commit -m "feat(admin): let managers add and remove other managers"
```

---

## Phase 5 — Superadmin panel

### Task 18: Superadmin panel

**Files:**
- Create: `src/pages/admin/index.astro`, `src/pages/admin/centers/[slug].astro`
- Test: `src/tests/admin/paypal-settings.test.ts`

**Interfaces:**
- Consumes: `guardSuperadmin` (T11); `listCenters`, `createCenter`, `getCenterBySlug`, `setCenterStatus`, `updatePaypal` (T5); `parseNewCenter`, `parsePaypal`, `parseEmail` (T13); `addCenterUser` (T5); `encryptSecret` (T2).
- Produces: `/admin` (list + create centers) and `/admin/centers/<slug>` (PayPal settings, enable/disable, first manager).

The PayPal save logic is the one place where a secret is handled, so it gets its own tested function.

- [ ] **Step 1: Write the failing test** (`src/tests/admin/paypal-settings.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updatePaypal } = vi.hoisted(() => ({ updatePaypal: vi.fn() }));
vi.mock('../../lib/repo/centers', () => ({ updatePaypal }));

import { decryptSecret } from '../../lib/crypto';
import { savePaypalSettings } from '../../lib/admin/paypal-settings';

const key = Buffer.alloc(32, 1).toString('base64');

beforeEach(() => vi.clearAllMocks());

describe('savePaypalSettings', () => {
  it('encrypts a new secret before storing it', async () => {
    await savePaypalSettings('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'live', secret: 'EXAMPLE-SECRET' }, key);
    const stored = updatePaypal.mock.calls[0][1];
    expect(stored.clientId).toBe('AbCdEfGhIjKlMn');
    expect(stored.env).toBe('live');
    expect(stored.secretEncrypted).not.toContain('EXAMPLE-SECRET');
    expect(decryptSecret(stored.secretEncrypted, key)).toBe('EXAMPLE-SECRET');
  });

  it('passes null so the stored secret is kept when the field is blank', async () => {
    await savePaypalSettings('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'sandbox', secret: null }, key);
    expect(updatePaypal).toHaveBeenCalledWith('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'sandbox', secretEncrypted: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/tests/admin/paypal-settings.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/admin/paypal-settings.ts`**

```ts
import { encryptSecret } from '../crypto';
import { updatePaypal } from '../repo/centers';
import type { PayPalFormInput } from './forms';

export async function savePaypalSettings(
  centerId: string,
  input: PayPalFormInput,
  encryptionKey: string,
): Promise<void> {
  await updatePaypal(centerId, {
    clientId: input.clientId,
    env: input.env,
    secretEncrypted: input.secret === null ? null : encryptSecret(input.secret, encryptionKey),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/tests/admin/paypal-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/pages/admin/index.astro`**

```astro
---
import AdminLayout from "../../layouts/AdminLayout.astro";
import { buttonClass, cardClass, inputClass, labelClass } from "../../components/admin/ui";
import { parseNewCenter } from "../../lib/admin/forms";
import { guardSuperadmin } from "../../lib/auth/guard";
import { createCenter, listCenters } from "../../lib/repo/centers";

const guard = await guardSuperadmin(Astro);
if (guard instanceof Response) return guard;
const { actor } = guard;

if (Astro.request.method === 'POST') {
  const parsed = parseNewCenter(await Astro.request.formData());
  if (!parsed.ok) return Astro.redirect(`/admin?error=${encodeURIComponent(parsed.error)}`, 303);
  const created = await createCenter(parsed.value);
  if (!created) return Astro.redirect(`/admin?error=${encodeURIComponent('Ya existe un centro con ese identificador')}`, 303);
  return Astro.redirect(`/admin/centers/${created.slug}?ok=1`, 303);
}

const centers = await listCenters();
---

<AdminLayout title="Centros" actor={actor} active="centers">
  <div class={`${cardClass} overflow-x-auto`}>
    {centers.length === 0 ? (
      <p class="text-gray-500">Todavía no hay centros.</p>
    ) : (
      <table class="w-full text-left text-sm">
        <thead class="text-xs uppercase text-gray-500">
          <tr>
            <th class="py-2 pr-4">Centro</th>
            <th class="py-2 pr-4">Dirección</th>
            <th class="py-2 pr-4">PayPal</th>
            <th class="py-2 pr-4">Estado</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {centers.map((center) => (
            <tr>
              <td class="py-3 pr-4 font-medium text-gray-900">{center.name}</td>
              <td class="py-3 pr-4"><a href={`/${center.slug}`} class="text-teal-700 hover:underline">/{center.slug}</a></td>
              <td class="py-3 pr-4">{center.paypal_configured ? `Configurado (${center.paypal_env})` : 'Sin configurar'}</td>
              <td class="py-3 pr-4">{center.status === 'active' ? 'Activo' : 'Desactivado'}</td>
              <td class="py-3 text-right space-x-4">
                <a href={`/admin/centers/${center.slug}`} class="text-teal-700 hover:underline">Ajustes</a>
                <a href={`/${center.slug}/admin`} class="text-teal-700 hover:underline">Panel</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>

  <form method="post" class={`${cardClass} space-y-4`}>
    <h2 class="text-lg font-semibold text-gray-900">Nuevo centro</h2>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class={labelClass} for="slug">Identificador (URL)</label>
        <input id="slug" name="slug" class={inputClass} maxlength="40" required />
        <p class="mt-1 text-xs text-gray-500">Minúsculas, números y guiones. No se puede cambiar después.</p>
      </div>
      <div>
        <label class={labelClass} for="name">Nombre</label>
        <input id="name" name="name" class={inputClass} maxlength="80" required />
      </div>
    </div>
    <button type="submit" class={buttonClass}>Crear centro</button>
  </form>
</AdminLayout>
```

- [ ] **Step 6: Create `src/pages/admin/centers/[slug].astro`**

```astro
---
import AdminLayout from "../../../layouts/AdminLayout.astro";
import { buttonClass, cardClass, inputClass, labelClass } from "../../../components/admin/ui";
import { parseEmail, parsePaypal } from "../../../lib/admin/forms";
import { savePaypalSettings } from "../../../lib/admin/paypal-settings";
import { guardSuperadmin } from "../../../lib/auth/guard";
import { getCenterBySlug, setCenterStatus } from "../../../lib/repo/centers";
import { addCenterUser } from "../../../lib/repo/users";

const guard = await guardSuperadmin(Astro);
if (guard instanceof Response) return guard;
const { actor } = guard;

const center = await getCenterBySlug(Astro.params.slug ?? '');
if (!center) return new Response('Centro no encontrado', { status: 404 });

const here = `/admin/centers/${center.slug}`;
const fail = (message: string) => Astro.redirect(`${here}?error=${encodeURIComponent(message)}`, 303);

if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData();
  const intent = form.get('intent');

  if (intent === 'paypal') {
    const parsed = parsePaypal(form);
    if (!parsed.ok) return fail(parsed.error);
    if (!center.paypal_configured && parsed.value.secret === null) return fail('Introduce el secret de PayPal');
    await savePaypalSettings(center.id, parsed.value, import.meta.env.ENCRYPTION_KEY);
  } else if (intent === 'status') {
    const status = form.get('status');
    if (status !== 'active' && status !== 'disabled') return fail('Estado no válido');
    await setCenterStatus(center.id, status);
  } else if (intent === 'add_user') {
    const parsed = parseEmail(form.get('email'));
    if (!parsed.ok) return fail(parsed.error);
    await addCenterUser(center.id, parsed.value);
  } else {
    return fail('Acción no válida');
  }
  return Astro.redirect(`${here}?ok=1`, 303);
}
---

<AdminLayout title={`Ajustes de ${center.name}`} actor={actor} active="centers">
  <p class="text-sm text-gray-600">
    <a href="/admin" class="text-teal-700 hover:underline">← Todos los centros</a>
    · <a href={`/${center.slug}/admin`} class="text-teal-700 hover:underline">Panel del centro</a>
    · <a href={`/${center.slug}/admin/users`} class="text-teal-700 hover:underline">Encargados</a>
  </p>

  <form method="post" class={`${cardClass} space-y-4`}>
    <input type="hidden" name="intent" value="paypal" />
    <h2 class="text-lg font-semibold text-gray-900">PayPal</h2>
    <p class="text-sm text-gray-600">
      Estado: {center.paypal_configured ? `configurado (${center.paypal_env})` : 'sin configurar'}. El secret nunca se muestra; déjalo en blanco para conservar el actual.
    </p>
    <div>
      <label class={labelClass} for="client_id">Client ID</label>
      <input id="client_id" name="client_id" class={inputClass} value={center.paypal_client_id ?? ''} autocomplete="off" required />
    </div>
    <div>
      <label class={labelClass} for="secret">Secret</label>
      <input id="secret" name="secret" type="password" class={inputClass} autocomplete="new-password" />
    </div>
    <div>
      <label class={labelClass} for="env">Entorno</label>
      <select id="env" name="env" class={inputClass}>
        <option value="sandbox" selected={center.paypal_env === 'sandbox'}>Sandbox (pruebas)</option>
        <option value="live" selected={center.paypal_env === 'live'}>Live (dinero real)</option>
      </select>
    </div>
    <button type="submit" class={buttonClass}>Guardar PayPal</button>
  </form>

  <form method="post" class={`${cardClass} space-y-4`}>
    <input type="hidden" name="intent" value="status" />
    <h2 class="text-lg font-semibold text-gray-900">Visibilidad</h2>
    <p class="text-sm text-gray-600">Un centro desactivado desaparece del listado, su web da 404 y no admite donaciones nuevas.</p>
    <select name="status" class={inputClass}>
      <option value="active" selected={center.status === 'active'}>Activo</option>
      <option value="disabled" selected={center.status === 'disabled'}>Desactivado</option>
    </select>
    <button type="submit" class={buttonClass}>Guardar visibilidad</button>
  </form>

  <form method="post" class={`${cardClass} space-y-4`}>
    <input type="hidden" name="intent" value="add_user" />
    <h2 class="text-lg font-semibold text-gray-900">Añadir encargado</h2>
    <div>
      <label class={labelClass} for="email">Correo de Google</label>
      <input id="email" name="email" type="email" class={inputClass} required />
    </div>
    <button type="submit" class={buttonClass}>Añadir encargado</button>
  </form>
</AdminLayout>
```

- [ ] **Step 7: Verify**

Run: `pnpm exec vitest run && pnpm exec astro check && pnpm run build`
Expected: PASS; no new `astro check` errors; build succeeds.

- [ ] **Step 8: Commit (ask Gloria first)**

```bash
git add src/lib/admin/paypal-settings.ts src/pages/admin src/tests/admin/paypal-settings.test.ts
git commit -m "feat(admin): add superadmin panel for centers and PayPal settings"
```

---

## Phase 6 — Verification, documentation and rollout

### Task 19: Access-control E2E, README and spec alignment

**Files:**
- Create: `tests/e2e/admin-access.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-02-multi-center-design.md`

**Interfaces:**
- Consumes: the mock database fixtures (T9): manager `manager@example.org` belongs to `recoletos` only; superadmin is `boss@example.org`; session secret `e2e-session-secret-e2e-session-secret` (from `playwright.config.ts`).

Google sign-in itself cannot run in CI; the E2E tests mint session cookies with the test `SESSION_SECRET` (the same format the app issues) and exercise everything behind the cookie. Google sign-in is covered by the manual check in Task 12 and the rollout runbook.

- [ ] **Step 1: Write `tests/e2e/admin-access.spec.ts`**

```ts
import { SignJWT } from 'jose';
import { expect, test, type BrowserContext } from '@playwright/test';

const secret = new TextEncoder().encode('e2e-session-secret-e2e-session-secret');
const ORIGIN = 'http://localhost:4321';

const mint = (email: string) =>
    new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(`uid-${email}`)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

async function signIn(context: BrowserContext, email: string) {
    await context.addCookies([{ name: 'session', value: await mint(email), url: ORIGIN }]);
}

test.describe('admin access control', () => {
    test('anonymous visitors are sent to the login page', async ({ page }) => {
        await page.goto('/recoletos/admin');
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByRole('button', { name: 'Entrar con Google' })).toBeVisible();
    });

    test('a forged cookie is rejected', async ({ page, context }) => {
        await context.addCookies([{ name: 'session', value: 'forged.value.here', url: ORIGIN }]);
        await page.goto('/recoletos/admin');
        await expect(page).toHaveURL(/\/login$/);
    });

    test('a manager reaches the panel of their own center', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin');
        await expect(page.getByRole('heading', { name: 'Apariencia' })).toBeVisible();
    });

    test('a manager cannot open another center or the superadmin panel', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        expect((await page.goto('/otro/admin'))?.status()).toBe(403);
        expect((await page.goto('/admin'))?.status()).toBe(403);
    });

    test('an unregistered Google account gets nothing', async ({ page, context }) => {
        await signIn(context, 'stranger@example.org');
        expect((await page.goto('/recoletos/admin'))?.status()).toBe(403);
    });

    test('the superadmin sees the centers and can open any panel', async ({ page, context }) => {
        await signIn(context, 'boss@example.org');
        await page.goto('/admin');
        await expect(page.getByRole('heading', { name: 'Centros' })).toBeVisible();
        expect((await page.goto('/otro/admin'))?.status()).toBe(200);
    });

    test('cross-origin writes are blocked', async ({ request }) => {
        const response = await request.post('/api/auth/logout', {
            headers: { origin: 'https://evil.example.com' },
            maxRedirects: 0,
        });
        expect(response.status()).toBe(403);
    });

    test('same-origin logout redirects to login', async ({ request }) => {
        const response = await request.post('/api/auth/logout', {
            headers: { origin: ORIGIN },
            maxRedirects: 0,
        });
        expect(response.status()).toBe(303);
        expect(response.headers()['location']).toBe('/login');
    });

    test('upload endpoint and PayPal endpoints respect center boundaries', async ({ request }) => {
        const anonymous = await request.post('/api/recoletos/upload', {
            headers: { origin: ORIGIN },
            data: {},
            maxRedirects: 0,
        });
        expect(anonymous.status()).toBe(401);

        const unknown = await request.post('/api/no-existe/paypal/create-order', {
            headers: { origin: ORIGIN },
            data: { itemId: '33333333-3333-4333-8333-333333333333', amount: 10 },
        });
        expect(unknown.status()).toBe(404);
    });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm exec playwright test`
Expected: all tests PASS (donation flow from Task 9 and the new access-control tests). If `Apariencia` or `Centros` headings are matched by more than one element, tighten with `{ level: 1 }`.

- [ ] **Step 3: Align the spec with the E2E approach**

In `docs/superpowers/specs/2026-10-02-multi-center-design.md`, replace the bullet

```
- **E2E (Playwright):** the donation flow against `/recoletos`, plus a login flow using the Firebase Auth emulator; a manager of one center cannot reach another center's admin.
```

with

```
- **E2E (Playwright):** the donation flow against `/recoletos`, plus access-control flows driven by session cookies minted with the test `SESSION_SECRET` (a manager of one center cannot reach another center's admin, anonymous and forged cookies go to `/login`, cross-origin writes are rejected). Google sign-in itself is verified manually against a real Firebase project.
```

(If the spec's wording differs slightly, change only the "Firebase Auth emulator" clause to the cookie-based description above.)

- [ ] **Step 4: Rewrite `README.md`**

````markdown
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
````

- [ ] **Step 5: Final verification of the whole suite**

Run: `pnpm audit && pnpm exec astro check && pnpm exec vitest run && pnpm run build && pnpm exec playwright test`
Expected: all pass. Fix any `pnpm audit` finding in the newly added dependencies (`jose`, `firebase`, `@vercel/blob`) by upgrading them; do not suppress it.

- [ ] **Step 6: Commit (ask Gloria first)**

```bash
git add tests/e2e/admin-access.spec.ts README.md docs/superpowers/specs
git commit -m "test: cover admin access control end to end and document the platform"
```

---

### Task 20: Rollout runbook (manual, with Gloria)

No new code. These steps cross Vercel, Neon, Firebase and PayPal, so each one needs Gloria at the keyboard. Do not run any production step without explicit confirmation.

- [ ] **Step 1: Firebase project**

Create the Firebase project, enable Authentication → Google, register a web app, and add `wish-list-reco.vercel.app` (and `wish-list.vercel.app` if the project is renamed) to Authentication → Settings → Authorized domains.

- [ ] **Step 2: Vercel environment variables (Production and Preview)**

Add `ENCRYPTION_KEY`, `SESSION_SECRET`, `SUPERADMIN_EMAIL`, `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`. Keep `POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`. Do **not** remove the old `PAYPAL_*` variables yet.

Run (locally, to generate values): `openssl rand -base64 32` for `ENCRYPTION_KEY` and `openssl rand -base64 48` for `SESSION_SECRET`.

- [ ] **Step 3: Rehearse on a Neon branch (repeat of Task 4 Step 4 plus the SQL tests)**

Run:
```bash
export POSTGRES_URL='<fresh rehearsal branch from production>'
node scripts/snapshot-totals.mjs before > "$TMPDIR/before.json"
node scripts/migrate.mjs
node scripts/snapshot-totals.mjs after > "$TMPDIR/after.json"
diff "$TMPDIR/before.json" "$TMPDIR/after.json" && echo TOTALS IDENTICAL
TEST_DATABASE_URL="$POSTGRES_URL" pnpm exec vitest run src/tests/integration
```
Expected: `TOTALS IDENTICAL` and the integration tests PASS.

- [ ] **Step 4: Preview deployment against the rehearsal branch**

Push the branch (with Gloria's approval), let Vercel build a preview with its `POSTGRES_URL` pointing at the rehearsal branch, then check in the preview URL:
1. `/` lists "Oratorio de Recoletos"; `/recoletos` shows the same texts, image and items as the live site; item pages open; `/item/<id>` redirects.
2. `/login` with the superadmin Google account lands on `/admin`; create a test center `prueba`; open its panel; upload a hero image and a logo; create an item; add a manual donation and see the progress bar move; void it.
3. Add a second Google account as manager of `prueba`; sign in with it: it reaches `/prueba/admin` and gets 403 on `/recoletos/admin` and `/admin`.
4. Try to remove the only manager as that manager: the page says the last manager cannot be removed.
5. In `/admin/centers/recoletos`, enter the Recoletos sandbox PayPal Client ID and Secret (`sandbox`), then make a sandbox donation on `/recoletos`; the donation appears in `/recoletos/admin/donations` and the progress updates. Repeat the capture request (browser retry) and confirm it is not counted twice.
6. Sign in with Google on the preview under the real CSP (no CSP violations in the console).
7. Delete an item that has an image, and run `\d item_images` on the rehearsal branch to confirm the foreign key and the cascade behave as expected.

- [ ] **Step 5: Production cut-over (short window; pick a quiet moment)**

Deploy before migrating: while the schema is missing the new `capture-order` fails before capturing anything and Recoletos answers 503 until its credentials are entered, whereas the old code running after the migration could capture a PayPal payment and then fail its `UPDATE` of the dropped `raised_amount` column (paid but unrecorded).

1. Take the `before` snapshot: `POSTGRES_URL='<production url>' node scripts/snapshot-totals.mjs before > "$TMPDIR/before.json"`.
2. Merge the PR (Gloria's call) and deploy the new code: promote the production deployment in Vercel.
3. IMMEDIATELY run `POSTGRES_URL='<production url>' node --env-file=.env scripts/migrate.mjs` against production (or export `POSTGRES_URL` and run `node scripts/migrate.mjs`); keep the window between steps 2 and 3 to minutes.
4. Take the `after` snapshot and diff it against `before` as in Step 3 (`TOTALS IDENTICAL`).
5. Open `/admin/centers/recoletos` and enter the live PayPal Client ID and Secret with environment `live` (same credentials that are currently in `PAYPAL_CLIENT_ID` / `PAYPAL_APP_SECRET`). Until this is saved, donations on `/recoletos` answer "Este centro todavía no acepta donaciones".
6. Make one small real donation and confirm it appears in the ledger and in PayPal.

- [ ] **Step 6: Clean up**

After a successful live donation, delete `PAYPAL_CLIENT_ID`, `PAYPAL_APP_SECRET`, `PUBLIC_PAYPAL_ENVIRONMENT` and `PUBLIC_PAYPAL_CLIENT_ID` from Vercel, delete the Neon rehearsal branch, and remove the test center `prueba` if it was created in production.

- [ ] **Step 7: Domain (Gloria's decision, outside the code)**

Renaming the Vercel project to `wish-list` changes the default domain to `wish-list.vercel.app`. Keep `wish-list-reco.vercel.app` as an additional domain if the old links must keep working, and add the new domain to Firebase's authorized domains.

---

## Notes carried over from the code review of the current implementation

- When a donor ticks "Cubrir gastos de gestión", PayPal charges the amount plus fees, and the current code credits the full captured amount to the item. The plan preserves that behaviour (spec: "PayPal fee formula … must not change"). Decide separately whether the ledger should record only the net donation.
- `ALTER TYPE item_status` cannot drop `funded`; the value stays in the enum but is no longer written.

## Self-review

- **Spec coverage:** data model (T4, T5), routes (T9), PayPal per center and idempotent capture (T7, T8), auth and session (T10–T12), authorization, bajas inmediatas and CSRF (T11), CSP (T11), uploads (T14), appearance/items/donations/users panels (T14–T17), superadmin panel and write-only secret (T18), migration with totals check and rehearsal (T4, T20), tests (every task, T6 for SQL, T19 for E2E), README (T19).
- **Placeholder scan:** none; every code step contains the code.
- **Type consistency:** repository names and signatures in Task 5 match their uses in Tasks 8, 9, 11, 12, 14–18; `Actor`, `AccessResult`, `Parsed<T>` and `PayPalFormInput` are defined before use.
