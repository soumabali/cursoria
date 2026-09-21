-- Terms acceptance, and a record that a purchase was confirmed to the buyer.
--
-- Why this exists: the sign-in form has always had a required "I agree to the
-- store policies" checkbox, but it lived entirely in the browser. Nothing was
-- ever sent to the server, so there was no evidence that any particular
-- customer had accepted the licence -- which is exactly the thing a store
-- owner needs if a purchase is ever disputed. A required checkbox that is
-- never recorded is decoration, not a licence.
--
-- Two timestamps, deliberately separate:
--   users.terms_accepted_at     when this account first accepted the policies
--   orders.policies_accepted_at when THIS purchase accepted them
--
-- The second is not redundant. Acceptance is per-purchase: the policies can
-- change between two purchases, and a licence for a given pack is accepted at
-- the moment that pack is acquired. Storing only the first would leave every
-- later purchase unprovable, and storing only the account-level one would
-- make it impossible to show which policy version a given order agreed to.
--
-- Both are nullable on purpose. Existing rows predate the checkbox being
-- recorded, and a NULL honestly says "no evidence" rather than backdating
-- agreement that was never captured. Do not backfill these.

-- Acceptance travels with the sign-in token. The checkbox is ticked when the
-- form is submitted, but the account only exists after the emailed link is
-- clicked, so the flag has to survive the gap between the two requests. Putting
-- it here rather than trusting the verify call means a client cannot claim
-- acceptance it never gave.
ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS accepted boolean NOT NULL DEFAULT false;

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS policies_accepted_at timestamptz;

-- Receipt delivery is tracked separately from payment state. A paid order and
-- a receipt that actually reached the buyer are different facts: email can be
-- unconfigured, the provider can be down, and the webhook path must never be
-- made to fail because of either. Reconciliation stays authoritative; this
-- column records what was told to the customer, not whether they paid.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_sent_at timestamptz;

-- Reconciliation looks orders up by id, but the receipt is sent once per
-- payment event and the guard below reads these two columns together.
CREATE INDEX IF NOT EXISTS orders_receipt_pending_idx
  ON orders(id) WHERE status = 'paid' AND receipt_sent_at IS NULL;
