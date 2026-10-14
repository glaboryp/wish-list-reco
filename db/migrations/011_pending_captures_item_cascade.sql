ALTER TABLE pending_captures DROP CONSTRAINT IF EXISTS pending_captures_item_id_fkey
-- breakpoint
ALTER TABLE pending_captures ADD CONSTRAINT pending_captures_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
