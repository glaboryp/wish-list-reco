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
