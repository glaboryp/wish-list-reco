ALTER TABLE donations ADD COLUMN fee_amount numeric(10, 2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0)
