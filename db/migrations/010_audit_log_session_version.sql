CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid REFERENCES centers(id) ON DELETE CASCADE,
  actor_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)
-- breakpoint
CREATE INDEX audit_log_center_created_idx ON audit_log (center_id, created_at DESC)
-- breakpoint
CREATE TABLE user_sessions (
  email text PRIMARY KEY,
  session_version integer NOT NULL DEFAULT 0
)
