-- Account deletion support.
--
-- Users are anonymised rather than deleted: orders and payment_events are
-- financial records that must survive a deletion request, and orders.user_id
-- references users(id). Deleting the user row would either destroy those
-- records or fail on the foreign key.
--
-- `deleted_at` distinguishes a self-deleted account from one an operator
-- disabled, so support can answer "was this removed by the owner?" without
-- guessing. It is also what the retention job uses to find accounts that
-- have been dormant long enough to purge their remaining traces.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- A deleted account must never be able to sign back in. The sign-in upsert
-- already skips rows where disabled = true, and deletion sets disabled, so
-- this index just keeps that lookup cheap.
CREATE INDEX IF NOT EXISTS users_email_active_idx ON users(email) WHERE NOT disabled;

-- Retention: anonymised accounts keep their orders (financial records) but
-- name and email are already scrubbed at deletion time, so nothing further
-- identifies the person. The audit entries that record the deletion keep
-- the tombstone address, not the original.
COMMENT ON TABLE product_views IS
  'Hashed first-party visitor cookie, counted once per product per day. Not linked to an account, so account deletion does not remove these rows.';
COMMENT ON COLUMN users.deleted_at IS
  'Set when the account owner deleted their own account. The row is retained because orders reference it; email/name are scrubbed.';
