# Session — terms acceptance and purchase receipts

Date: 2026-09-22
Project: Cursoria / "Cursor Studio"

Both items came from the product/ops review, and both were the same kind of
defect: a promise the product makes to a customer that the code did not keep.

## 1. Terms acceptance was never recorded

The sign-in form has always had a required "I agree to the store policies"
checkbox (`components/actions.tsx`). It lived entirely in the browser. Nothing
was ever sent to the server, so there was no evidence that any customer had
accepted the licence — the exact thing needed if a purchase is disputed.

A required checkbox that is never stored is decoration, not a licence.

Design decisions worth keeping:

- The flag travels on **`login_tokens.accepted`**, not on the verify call. The
  account only exists after the emailed link is clicked, so the flag has to
  survive the gap between the two requests. Storing it on the token means a
  client cannot claim acceptance it never gave by calling `/api/auth/verify`
  directly.
- **`users.terms_accepted_at`** uses `COALESCE(terms_accepted_at,now())`, so a
  later sign-in cannot rewrite when the account first agreed.
- **`orders.policies_accepted_at`** is per purchase and is NOT redundant.
  Terms change, and a licence dispute is about a specific pack acquired at a
  specific time; an account-level timestamp alone would leave later purchases
  unprovable.
- Both timestamps are nullable and were **deliberately not backfilled**. NULL
  honestly means "no evidence" for rows that predate this. Backfilling would
  fabricate agreement that was never captured.

## 2. Receipts: a buyer paid and heard nothing

The only outbound email in the app was the sign-in link. Someone could pay and
receive no confirmation of any kind.

`lib/email.ts` now owns all outbound mail, so the sign-in link and the receipt
cannot drift apart. The sign-in route was changed to call it rather than
inlining a Resend request.

**The part worth reviewing is the claim.** `sendReceipt` does not check
`receipt_sent_at` and then send — it *claims* the send with a conditional
UPDATE first:

```
UPDATE orders o SET receipt_sent_at=now() ...
 WHERE o.id=$1 AND o.status='paid' AND o.receipt_sent_at IS NULL
 RETURNING ...
```

Two reconciliations for one order would otherwise both read the column as NULL
and both mail the buyer. Webhook retries make that routine rather than exotic.
If the claim returns no row, nothing is sent. If the send fails, the column is
cleared so a transient provider outage does not permanently mark an order as
receipted. The mail-configured guard runs *before* the claim, so a store with
no provider configured reconciles cleanly without claiming it sent something.

The receipt is sent **after** the grant commits, never inside the statement. If
mail were sent first and the transaction then failed, the buyer would hold a
receipt for access they do not have.

## Verification

Unit: suite 20 → **24** tests, including that the claim is conditional, that a
second claim sends nothing, that a failure releases the claim, and that no work
happens when mail is unconfigured. tsc and lint clean.

Production, end to end:
- `auth/request` with `accepted:true` → token row `accepted=true`; verify →
  `users.terms_accepted_at` set.
- Reset, then `accepted:false` → column stayed NULL. The record is honest.
- A real free product (uploaded ZIP + PNG, saved through the admin API) was
  claimed: order created, `policies_accepted_at` set, **`receipt_sent_at` set**
  — the mail actually went out through Resend.
- Claimed again: `receipt_sent_at` unchanged. No second email.
- The claim SQL run directly against the live schema returned the row on the
  first call and nothing on the second; an unpaid order was not claimable.

All verification data removed afterwards: DB back to 1 user (the owner), 0
products, 0 orders, 0 entitlements, 0 uploads; R2 empty; `/` and `/policies`
serving 200.

## Note on the test harness

The suite transpiles real modules to data URLs and stubs only `sql`/`fetch`.
Adding `lib/email.ts` meant `lib/payments.ts` and the API route both needed
their `./email` / `@/lib/email` specifiers rewritten to the compiled module,
because a data URL cannot resolve a relative import. Worth knowing before
adding the next module to the graph.

## Still not done, and not mine to decide

`CONTACT_EMAIL` is still a placeholder and the operator identity is unwritten,
so `/policies` still carries its own notice saying so. That is the operator's
decision, not a gap in the implementation.
