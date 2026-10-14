ALTER TABLE pending_captures DROP CONSTRAINT pending_captures_status_check
-- breakpoint
ALTER TABLE pending_captures ADD CONSTRAINT pending_captures_status_check
  CHECK (status IN ('pending', 'recorded', 'not_paid', 'needs_review', 'resolved'))
-- breakpoint
ALTER TABLE pending_captures
  ADD COLUMN paypal_capture_id text,
  ADD COLUMN resolved_by text,
  ADD COLUMN resolution_note text
