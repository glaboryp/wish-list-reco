ALTER TABLE centers
  ADD COLUMN notify_mode text NOT NULL DEFAULT 'each' CHECK (notify_mode IN ('each', 'daily', 'none'))
