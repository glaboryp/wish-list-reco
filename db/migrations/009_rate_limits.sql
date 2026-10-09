CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
)
-- breakpoint
CREATE INDEX rate_limits_window_start_idx ON rate_limits (window_start)
