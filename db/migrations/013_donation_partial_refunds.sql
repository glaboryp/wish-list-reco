ALTER TABLE donations
  ADD COLUMN refunded_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN refunded_at timestamptz
-- breakpoint
ALTER TABLE donations ADD CONSTRAINT donations_refunded_amount_check
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount)
-- breakpoint
CREATE INDEX donations_partial_refunds_idx ON donations (refunded_at DESC) WHERE refunded_amount > 0
