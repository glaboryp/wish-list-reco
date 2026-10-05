ALTER TABLE donations ADD COLUMN voided_by text, ADD COLUMN void_reason text
-- breakpoint
ALTER TABLE donations DROP CONSTRAINT donations_check
-- breakpoint
ALTER TABLE donations ADD CONSTRAINT donations_source_shape_check CHECK (
  (source = 'paypal' AND paypal_capture_id IS NOT NULL)
  OR (source = 'manual' AND paypal_capture_id IS NULL AND voided_by IS NULL AND void_reason IS NULL)
)
