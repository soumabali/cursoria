-- Records email addresses whose account was deleted by its owner.
--
-- Why this exists: deletion wants to scrub the address off the users row,
-- but signing in recreates accounts with
--   INSERT ... ON CONFLICT(email) DO UPDATE ... WHERE NOT users.disabled
-- Scrub the email and the conflict no longer matches the disabled row, so
-- the next sign-in with that address silently creates a fresh active
-- account and the deletion is undone. Keeping the address here is what
-- makes "deleted" actually mean deleted.
--
-- The hash is sha256(lower(email)), hex. The plaintext address is not
-- stored, so this table does not reintroduce the personal data that
-- deletion removed; it only lets the sign-in path recognise an address
-- that must never be issued a new link.

CREATE TABLE IF NOT EXISTS deleted_identities(
  email_hash text PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE deleted_identities IS
  'sha256(lower(email)) of accounts whose owner deleted them. Sign-in refuses these addresses so a deletion cannot be undone by signing in again.';
