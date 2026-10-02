# Multi-Center Wish List Platform

## Objective

Turn the single-center wish list (Oratorio Recoletos) into a multi-center platform that one operator (the superadmin) maintains in a single codebase and deployment. Other centers get their own public wish list and manage it themselves through an admin panel, without programming or maintaining anything. Each center collects donations in its own PayPal account.

## Success criteria

- The superadmin can create a new center, set its PayPal credentials and invite its first manager without a deploy.
- A center manager can change the hero image, logo, primary color, texts and wish list items (with prices) without help.
- A center manager can invite and remove other managers of the same center.
- A manager of center A can never read or modify data of center B.
- A donation is never counted twice and a captured PayPal payment is never silently lost.
- The existing Recoletos site keeps working under its new URL with unchanged totals.

## Scope

- Public routes: `/` lists active centers, `/<slug>` is a center's wish list, `/<slug>/item/<id>` is an item detail.
- Per-center PayPal credentials (client id, encrypted secret, `sandbox`/`live`) stored in the database and used by the existing order endpoints.
- Authentication with Firebase Authentication, Google sign-in only. Authorization is based on emails registered in the database.
- Superadmin panel at `/admin`, center panel at `/<slug>/admin`.
- Image upload to Vercel Blob for hero image, logo and item images.
- A `donations` ledger with `paypal` and `manual` sources; amounts raised are derived from it.
- Per-center customization: hero image, hero title and text, logo, primary color.
- Migration of the current Recoletos data into the new model.

## Explicit exclusions

- Custom domains per center (routes under the Vercel domain only).
- Email/password or magic-link login.
- Donor personal data and email notifications.
- Rate limiting and encryption key rotation.
- Free-form page design; all centers share one layout.
- Renaming the Vercel project or domain (done in Vercel settings, outside the code).

## Technical design

### Approach

A single Astro application with a `center_id` on tenant data. The admin panels live in the same app. Rejected alternatives: one deployment per center (does not scale operationally) and a separate admin application (duplicate configuration with no clear benefit at this size).

### Data model

New tables:

- `centers`: `id`, `slug` (unique, immutable after creation), `name`, `status` (`active` | `disabled`), `hero_title`, `hero_text`, `hero_image_url`, `logo_url`, `primary_color`, `paypal_client_id`, `paypal_secret_encrypted`, `paypal_env` (`sandbox` | `live`), timestamps.
- `center_users`: `center_id`, `email` (lowercase), `firebase_uid` (null until first login), timestamps. Unique on `(center_id, email)`, so a center has any number of managers and one person may manage several centers.
- `donations`: `id`, `center_id`, `item_id`, `amount`, `currency`, `source` (`paypal` | `manual`), `paypal_capture_id` (unique, null for manual), `note`, `voided_at` (manual donations only), `created_at`.

Changed tables:

- `items` gains `center_id` and loses `raised_amount`. Raised amount is the sum of non-voided `donations` for the item; "funded" is derived from raised >= goal. `status` keeps `draft` and `active` plus `archived` for items that already have donations.
- `item_images` is unchanged.

The superadmin is not stored in the database: it is the email in the `SUPERADMIN_EMAIL` environment variable.

### Routes

Public:

- `/`, `/<slug>`, `/<slug>/item/<id>`.
- `/api/<slug>/paypal/create-order` and `/api/<slug>/paypal/capture-order`. The center is resolved from the slug; credentials come from the database and are decrypted server-side. The PayPal brand name comes from the center.
- Reserved slugs (`admin`, `api`, `login`, and similar) are rejected on center creation.
- Legacy `/item/<id>` redirects to `/recoletos/item/<id>`.

Authentication:

- `/login`: Google sign-in in the browser; the server verifies the Firebase ID token, checks the email against `SUPERADMIN_EMAIL` or `center_users`, links `firebase_uid` on first login and sets a session cookie.
- Requests to `/admin` or `/<slug>/admin` without a valid session redirect to `/login`.

Superadmin panel (`/admin`): list and create centers, set PayPal credentials (the secret is write-only and never displayed), enable/disable a center, add the first manager. The superadmin can open any center's panel.

Center panel (`/<slug>/admin`):

- Appearance: hero title and text, hero image, logo, primary color, link to the public page.
- Items: create, edit, reorder, goal, image, draft/active. Items with donations are archived, not deleted.
- Donations: list, add manual donations, void manual donations. PayPal donations cannot be voided.
- Users: add and remove managers of the same center. A manager cannot remove the last manager of the center; the superadmin can revoke anyone.
- PayPal settings are not visible or editable by managers.

### Implementation notes

- Server-rendered Astro pages with regular form posts. Client JavaScript only for Google sign-in and image upload.
- Images are uploaded directly from the browser to Vercel Blob with a server-issued token, avoiding function body size limits. The server validates type (webp, jpg, png) and size; the blob path is prefixed with the center.
- The CSP in `src/middleware.ts` is extended for Google and Firebase domains.

### Security

- A single `requireCenterAccess(session, slug)` helper guards every admin page and mutation. The center is always derived from the URL on the server, never from the request body, and every query filters by `center_id`. `create-order` verifies the item belongs to the center in the route.
- Each request re-checks that the email is still in `center_users`, so removing a manager takes effect immediately.
- Session cookie: `httpOnly`, `secure`, `SameSite`; POST requests also check `Origin` against CSRF.
- PayPal secrets are encrypted with AES-256-GCM using a random IV per value; the key is `ENCRYPTION_KEY` (server-only environment variable).
- The primary color is validated for minimum contrast against white text.

### Payments and errors

- `capture-order` inserts the donation idempotently by `paypal_capture_id`. If the database write fails after PayPal captured the payment, a retry fetches the already-captured order from PayPal and completes the missing record instead of failing with a log line.
- A disabled center returns 404 on its public page and `create-order` refuses to charge.

### Migration

- A SQL migration creates the new tables, creates the `recoletos` center from the content currently hardcoded in `index.astro`, assigns existing items to it and inserts one `manual` donation per item with the current `raised_amount` (note: "migration") so totals are preserved, maps items currently stored as `funded` to `active` (funded becomes derived), then drops `raised_amount`.
- Rehearse on a Neon branch before production.
- The global `PAYPAL_*` variables are removed only after the Recoletos credentials are entered in the superadmin panel and a test payment succeeds.

## Validation and acceptance criteria

1. Unit tests (Vitest): encryption round-trip and tamper detection, `requireCenterAccess`, donation sums and derived funded state, slug validation, contrast validation.
2. API tests: existing `create-order` and `capture-order` tests adapted to centers, including cross-center isolation, disabled center, and idempotent capture retry.
3. E2E (Playwright): the donation flow against `/recoletos`, plus access-control flows driven by session cookies minted with the test `SESSION_SECRET` (a manager of one center cannot reach another center's admin, anonymous and forged cookies go to `/login`, cross-origin writes are rejected). Google sign-in itself is verified manually against a real Firebase project.
4. Migration rehearsal shows per-item totals identical before and after.
5. `pnpm exec astro check`, `pnpm exec vitest run` and `pnpm run build` pass.
