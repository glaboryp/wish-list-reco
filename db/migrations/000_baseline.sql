DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_status') THEN
    CREATE TYPE item_status AS ENUM ('draft', 'active', 'funded');
  END IF;
END
$$
-- breakpoint
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  goal_amount numeric(10, 2) NOT NULL DEFAULT 0.00,
  raised_amount numeric(10, 2) NOT NULL DEFAULT 0.00,
  status item_status NOT NULL DEFAULT 'draft',
  sort_order smallint DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
-- breakpoint
CREATE TABLE IF NOT EXISTS item_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  image_url varchar(1024) NOT NULL,
  alt_text varchar(255),
  sort_order smallint DEFAULT 0,
  created_at timestamptz DEFAULT now()
)
-- breakpoint
CREATE INDEX IF NOT EXISTS idx_item_images_on_item_id ON item_images (item_id)
