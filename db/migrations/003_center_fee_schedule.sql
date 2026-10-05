ALTER TABLE centers
  ADD COLUMN paypal_fee_percent numeric(5, 2) NOT NULL DEFAULT 2.90 CHECK (paypal_fee_percent >= 0 AND paypal_fee_percent <= 20),
  ADD COLUMN paypal_fee_fixed numeric(5, 2) NOT NULL DEFAULT 0.35 CHECK (paypal_fee_fixed >= 0 AND paypal_fee_fixed <= 5),
  ADD COLUMN card_fee_percent numeric(5, 2) NOT NULL DEFAULT 1.20 CHECK (card_fee_percent >= 0 AND card_fee_percent <= 20),
  ADD COLUMN card_fee_fixed numeric(5, 2) NOT NULL DEFAULT 0.35 CHECK (card_fee_fixed >= 0 AND card_fee_fixed <= 5)
