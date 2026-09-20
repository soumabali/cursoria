-- Run periodically from your operational scheduler. No runtime schema changes.
DELETE FROM login_tokens WHERE expires_at < now();
DELETE FROM sessions WHERE expires_at < now();
DELETE FROM rate_limits WHERE expires_at < now();
