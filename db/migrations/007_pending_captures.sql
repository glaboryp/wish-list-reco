CREATE TABLE pending_captures (
  paypal_order_id text PRIMARY KEY,
  center_id uuid NOT NULL REFERENCES centers(id),
  item_id uuid NOT NULL REFERENCES items(id),
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'not_paid', 'needs_review')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  resolved_at timestamptz
)
-- breakpoint
CREATE INDEX pending_captures_open_idx ON pending_captures (created_at) WHERE status IN ('pending', 'needs_review')
