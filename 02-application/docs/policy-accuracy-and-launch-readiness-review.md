# Cursoria — policy accuracy and first-customer readiness review

Read-only review. Files inspected: `app/policies/page.tsx`, `app/api/[...path]/route.ts`,
`app/dashboard/page.tsx`, `app/products/[slug]/page.tsx`, `app/signin|verify/page.tsx`,
`app/admin/[[...section]]/page.tsx`, `components/{actions,storefront,admin-forms,nav}.tsx`,
`lib/{db,security,payments,storage,catalog}.ts`, `worker/index.ts`,
`database/*.sql`, `tests/security.test.mjs`, `.env.example`, `docs/report-source.md`, `README.md`.

No file was modified and the production database was not touched.

---

## Part 1 — Where the published policy text and the code disagree

### 1.1 "Download entitlements … Access ends on deletion" is only true for *active* entitlements — and deleting an account permanently destroys paid access with no refund

**Policy says** (`app/policies/page.tsx:6`):

> `['Download entitlements','Kept while your account is active','Access ends on deletion']`

and line 40:

> "If you delete your account you lose access to download links for packs you previously acquired, so download anything you want to keep first."

**Code does** (`route.ts:55`):

```sql
dropped AS (UPDATE entitlements SET active=false WHERE user_id=$1 RETURNING user_id)
```

The entitlement rows are *not* deleted — they are flagged inactive, and the user row is only anonymised. This is a **deliberate and consistent** choice (orders must survive as financial records), and the policy does warn the customer. So the text is accurate. The discrepancy is one of framing, not fact, and it is the store owner's exposure: **a customer who paid Rp25,000 and later deletes their account loses the product with no refund and no way to restore it, because `deleted_identities` blocks the address from ever signing in again.** The policy discloses the loss but does not say the loss is unrecoverable or non-refundable.

**Fix:** add one sentence to the deletion section — "Deletion is permanent and is not a refund: because the address can never sign in again, a deleted account cannot be restored or re-issued." That single line closes the only realistic consumer-complaint path created by the deletion feature.

### 1.2 The retention table's "Not stored for active accounts" row is true but misleading about what remains after deletion

**Policy says** (`page.tsx:10`):

> `['A one-way hash of your email','Not stored for active accounts','Kept, to block sign-in with a deleted address']`

**Code:** correct — `deleted_identities` is written only at deletion. But `users.deleted_at` is also kept (added by `database/002_account_deletion.sql:13`) and is **absent from the retention table entirely**.

**Fix:** add a row `['Deletion marker (deleted_at on the anonymised account row)','—','Kept, to distinguish a self-deleted account from an operator-disabled one']`. Minor, but the table's own preamble ("What is kept, and for how long") invites the reader to treat it as complete.

### 1.3 "Order records … Kept, no longer linked to your identity" — the link survives in `entitlements` and `audit_log`

**Policy says** (`page.tsx:5`, `page.tsx:40`):

> "Order records … Kept, no longer linked to your identity"
> "the account it belonged to is replaced with a non-identifying value"

**Code:** the `users` row is **replaced** by a tombstone (`deleted+<hash16>@invalid`) but the row **still exists with the same UUID** (`route.ts:55`), and these retain that UUID:

- `entitlements.user_id` (flagged inactive, not removed)
- `orders.user_id` and `orders.creator_id`
- `audit_log.actor_id` (`route.ts:57` writes `account.delete` with `actor_id = u.id`)

Nothing a customer can read links those rows back to a person, so the *customer-facing* claim holds. But the claim of "no longer linked to your identity" is stronger than the data model supports: the pseudo-identity persists as a stable key. That matters if the store owner ever receives a data-subject request and has to represent, in writing, what "no longer identifies you" means.

**Fix:** no code change needed. Reword to "kept in a form that no longer contains your email or name", which is what is actually implemented and is defensible.

### 1.4 Refunds — the policy describes a process no part of the product implements

**Policy says** (`page.tsx:25–26`):

> "To request a refund, email us using the contact address below with the order number and the reason for the request. We aim to answer within 3 working days, and refunds are returned to the original payment method through Midtrans."
> "A confirmed full refund removes future download access for that order. Partial refunds pause access while the request is reviewed."

**Code:** there is **no refund UI, no refund API, and no admin action anywhere** — confirmed by grep across `app/`, `lib/`, `components/`. The only refund machinery is reactive: `lib/payments.ts:14` maps Midtrans's `refund` → `refunded` and `partial_refund` → `review`, and the atomic statement at `payments.ts:16` deactivates entitlements for both states. `README.md:71` states this plainly: "There is no automated refund or payout UI."

Consequence: **`refunded` and `review` can only be reached if someone issues the refund inside the Midtrans dashboard**, and `review` (partial refund) then *stops being resolvable from the product at all* — `README.md:71` says it must be cleared "through an authorized database operation". The policy promises the customer an outcome the store owner cannot produce through the store.

Two further mismatches inside the same policy:
- The policy says "we aim to answer within 3 working days" but the contact address is the literal placeholder **`CONTACT_EMAIL`** (`page.tsx:50`). There is no mailbox, so there is no procedure, so there is no response.
- "Partial refunds pause access while the request is reviewed" — the code pauses access (`SET active=false`) but **nothing ever reviews it**. A customer who is partially refunded loses the pack permanently with no resolution path.

**Fix (do before taking money):** (a) set a real monitored mailbox and the operator identity; (b) decide and write the actual refund policy — for digital goods in Indonesia the store owner must in any case honour the statutory withdrawal/pengembalian provisions, so this is their call, not the developer's; (c) either add a minimal superadmin "resolve review" action that flips `orders.status` to `refunded` and leaves the entitlement revoked, or state in the policy that a partial refund ends access. Do **not** ship the current sentence, which implies a review process that does not exist.

### 1.5 Cookies section is accurate, with one unstated cookie attribute

**Policy says** (`page.tsx:43`):

> "Signing in sets one first-party session cookie. Product pages use a random first-party identifier … We do not use advertising or third-party tracking cookies."

**Code:** correct. `cursor_session` (`route.ts:42`, 7-day maxAge, httpOnly, SameSite=Lax) and `cursor_visitor` (`route.ts:61`, 30-day maxAge, httpOnly, SameSite=Lax, keyed to `hash(visitor)` in `product_views`). No third-party cookies. The visitor cookie is httpOnly and cannot be read by JS — good, and the policy's "random first-party identifier" is a fair description.

One omission that matters for an EU/opt-in-style reading (not required for Indonesia, but the store is publicly reachable): the visitor cookie is set **before any consent prompt**, on the first product-page view (`TrackView` calls `views` unconditionally). The policy discloses it, which is the honest position. Flagging only so the owner knows there is no consent gate, should they later want one.

**Fix:** none required for Indonesia. Disclosure is adequate.

### 1.6 "Payment confirmation is handled on the server before download access is granted" — accurate

`page.tsx:18` vs `payments.ts:14–16` and `route.ts:117`: access is granted only by the atomic entitlement insert driven by Midtrans's authoritative `/v2/{id}/status` response, verified for order id, IDR currency and exact amount. The browser return URL grants nothing. **This claim is correct and well-implemented.**

### 1.7 Pricing section is accurate

"Free packs cost Rp0. Donation packs require at least the displayed minimum. Paid packs have a fixed price." — enforced twice: client (`actions.tsx:13`, `min={p.price}`) and server (`route.ts:69`, `z.number().int().min(p.price)`), plus a DB CHECK (`001_init.sql:7`). **Correct.**

---

## Part 2 — What would break for a real first customer

Ordered by pain to the customer.

### 2.1 BLOCKER — the only way to become a customer fails silently. `auth/request` returns 503 before anything else

`route.ts:15`:

```ts
if(!configured())return reply({error:'This is a store preview…'},503);
```

`configured()` is `Boolean(process.env.DATABASE_URL)` (`lib/db.ts:3`). If the variable is absent the whole API is off. That is intended. The real gap: **`const configured=Boolean(DATABASE_URL)` is the only gate — there is no check that the email path can actually send.** `route.ts:20` throws `'Email sign-in is not available yet.'` if `EMAIL_API_KEY`/`EMAIL_FROM` are missing, but only *after* the customer has typed their address and submitted a form whose button was enabled.

The button's enabled state is `available={configured() && !!process.env.EMAIL_API_KEY}` (`signin/page.tsx:4`), so the client *does* know — but if `EMAIL_FROM` is empty while `EMAIL_API_KEY` is set, the button is enabled and the submit fails. Low frequency, but it is a "the sign-in page lies to me" bug.

**Fix:** change the server-side guard to `configured() && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM` and pass the same three-part predicate into `SignIn`.

### 2.2 BLOCKER — a paid customer who closes the tab has no way to finish, and the "Continue payment" link is the only recovery

`route.ts:76` returns the stored `checkout_url` if the order already has one, otherwise creates a new Snap transaction. `route.ts:74` adds a `payment_key` and `production` snapshot to the order. That is sound. But:

- If Snap creation fails (`route.ts:79`) the order is left in `pending` with **no `checkout_url`**, and `dashboard/page.tsx:9` renders `Continue payment` only when `o.checkout_url` is set. The customer sees a pending order and a **Check payment** button. `orders/refresh` calls `reconcile`, which asks Midtrans for status of a transaction that was never created → `reconcile` throws `'Payment status is not available yet.'` (`payments.ts:11`) and the order is **permanently unpayable from the UI**: no link, no re-create path. The customer has to buy again, creating a second order.

**Fix:** in `orders/refresh`, when the order is `pending` and has no `checkout_url`, re-run the Snap creation instead of only reconciling. This is the single highest-impact code fix in this list.

### 2.3 BLOCKER — a refunded-then-*re-downloaded* pack, and a refunded order's `Check payment`, can re-open access

`payments.ts:16` handles this correctly *within* a reconcile call (refunded is terminal, later `pending`/`failed` cannot downgrade). But `route.ts:71` (free claims) and `payments.ts:16` (grant) both do:

```sql
ON CONFLICT(user_id,product_id) DO UPDATE SET active=true,order_id=EXCLUDED.order_id
```

For the **free** path there is no refund concept, fine. For the paid path, the reconcile statement guards with `WHERE NOT entitlements.active` — but the *same* `user_id,product_id` row can be re-activated by a **new order** for the same pack. The policy says "A confirmed full refund removes future download access **for that order**" (`page.tsx:26`) — the "for that order" qualifier is what saves it, and it is there. So this is **not** a policy violation.

The real residual risk: once refunded, nothing prevents the customer from clicking checkout again and getting the pack back for free only if the price is 0 — otherwise they pay again, which is correct. **No action needed; recording it because it is the kind of thing a reviewer is expected to check.**

### 2.4 MAJOR — `session.return_path` is accepted from the client and only regex-constrained

`route.ts:28`: `returnPath = typeof d.next==='string' && /^\/products\/[a-z0-9-]+$/.test(d.next) ? d.next : '/dashboard'`. The regex pins it to one path shape, and `verify` later redirects to it (`route.ts:42`). **This is safe** — a good example of validating rather than trusting. No fix.

### 2.5 MAJOR — the buyer journey has no email confirmation that a purchase succeeded

There is exactly one outbound email in the whole application: the sign-in link (`route.ts:30`). No order confirmation, no receipt, no "your pack is ready". For an Indonesian digital-goods buyer this is both a support-load problem and, more concretely, a **tax/accounting problem for the store owner** — the customer has no document to point at if they dispute the charge. Midtrans sends its own payment notification email, which partly covers it, but the store itself sends nothing.

**Fix:** send a receipt from the entitlement-grant path once Resend is live. This is the most-requested feature a first real customer will generate.

### 2.6 MODERATE — order history is capped and statuses are shown in raw lowercase English

`dashboard/page.tsx:9` limits to 100 orders, "Latest 200" in admin (`admin page:26`). The badge renders the raw enum (`pending`, `paid`, `failed`, `refunded`, `review`). For a single-digit-order store this is fine. Noting it only because `README.md:74` already acknowledges it.

### 2.7 MODERATE — there is no order-detail view, so "the order number" the policy asks for is not displayed

The policy tells the customer to email "the order number" (`page.tsx:25`). The dashboard shows date, pack, amount and status — **not the order id**. It is only visible in admin (`{r.id.slice(0,8)}`). A customer following the policy cannot supply what the policy requests.

**Fix:** show the short order id in the dashboard order table. One-line change.

---

## Part 3 — Missing before taking money from Indonesian customers

Flagging gaps only; not legal advice.

1. **No operator identity.** `page.tsx:50` renders the literal string `CONTACT_EMAIL`; `page.tsx:53` says the legal business name, address and governing law must be published before real orders. None exist. An Indonesian online store must identify the operator and provide a reachable contact.
2. **No refund/withdrawal statement that meets Indonesian consumer-protection expectations.** The current text is a developer placeholder and says so. Digital-goods distance selling has specific rules about the right of withdrawal and about refunds; the owner needs their own wording, not this.
3. **No tax handling whatsoever.** No VAT/PPN field, no NPWP, no invoice numbering, no tax document. `orders` records amount, date, status — not a tax-compliant record on its own (`001_init.sql:9`).
4. **No terms of service separate from the policy page.** Licensing terms live per-product (`products.license`), which is good, but there is no accepted-terms record: the sign-in form has a required "I agree to the store policies" checkbox (`actions.tsx:9`) that is **not stored anywhere** — no `accepted_at` column, no audit row. If a customer later disputes the licence or the policy, the store cannot show what they agreed to, or when.
5. **No business-registration / consumer-dispute information**, and no statement of which Indonesian consumer-protection authority or procedure applies.
6. **No privacy notice naming a data controller or a contact for data requests** beyond the same missing mailbox — relevant because the store already processes personal data (email, orders, visitor ids).

Items 1, 2 and 4 are the ones that block; 3 and 5, 6 should be resolved before meaningful volume.

---

## Part 4 — Dependency failure behaviour

| Dependency | What happens | Graceful? | Fails closed? |
|---|---|---|---|
| **Neon down** | `lib/db.ts:11` swallows the upstream status and throws `'The store is temporarily unavailable.'`. `POST` handler returns 400 (`route.ts:112`); `GET` handler returns **403** (`route.ts:119`). | Yes, message-wise | **Yes** — unauthenticated and unentitled requests are refused, never granted. Note the 403 for `GET /api/download` is correct-but-odd for an outage (looks like an auth failure). |
| **Database not configured** | `route.ts:15` returns 503 with "This is a store preview" for every POST. | Yes | Yes |
| **R2 down** | `lib/storage.ts:17` throws `'File storage is temporarily unavailable.'`. On boot (`GET /api/download/...`) the handler catches and returns **403** with the storage message as the error body (`route.ts:119`, `safeError`). | Yes | **Yes** — entitlement is checked before any storage call (`route.ts:117`), so a storage outage never leaks a package. |
| **R2 not configured** | `storage.ts:9` throws `'File storage is not connected yet.'`; same 403 path. | Yes | Yes |
| **Resend down** | `route.ts:31`: on `!sent.ok` the login token is deleted and a clear message returned. Also, `fetch` to Resend has **no timeout**, so a hung Resend connection holds the Worker request open until the platform timeout. | Yes | Yes |
| **Resend not configured** | `route.ts:20` throws `'Email sign-in is not available yet.'` — but only after the form was enabled (see 2.1). | Partly | Yes |
| **Midtrans down (checkout)** | `route.ts:79` throws `'Checkout could not be opened. Check your order in My Library before trying again.'`. The order row exists in `pending`. | Message-wise yes | Yes — no entitlement is created |
| **Midtrans down (reconcile)** | `payments.ts:11` throws `'Payment status is not available yet.'` | Yes | **Yes** — no grant on an unverifiable response |
| **Midtrans returns wrong amount/currency** | `payments.ts:12` throws `'Payment details do not match.'` before any write | Yes | **Yes** — verified and covered by a permanent test |
| **Midtrans notification with a forged signature** | `payments.ts:9` constant-time compare, throws before any network call | — | **Yes** — covered by a permanent test |
| **`SETTINGS_ENCRYPTION_KEY` missing/wrong** | `security.ts:15` throws `'Payment configuration is unavailable.'`; a wrong key throws inside `decrypt` and surfaces as a raw crypto error string via `safeError`. | Mostly | Yes |

**One genuine gap:** every `fetch` in the codebase (Neon, Resend, Midtrans, R2) is made **without an `AbortSignal`/timeout**. `lib/db.ts:10`, `route.ts:30`, `route.ts:78`, `payments.ts:10`, `storage.ts:16`. On a Worker the request dies at the platform limit and the customer sees a raw 5xx page rather than the considered error message all of these paths otherwise produce. Given that every dependency failure is otherwise handled well, this is worth 30 lines of shared timeout helper.

---

## What is genuinely ready — do not worry about these

- **Payment integrity.** Signature verification (constant-time), authoritative status re-fetch, order-id/currency/amount pinning, atomic locked reconciliation, event-hash dedupe for duplicate notifications, terminal-refund protection. Tested, and the tests exercise the real modules.
- **Entitlement gating on download.** `route.ts:117` checks session → verified → active entitlement → then storage. A permanent test proves an authenticated user with no entitlement gets 403 and that storage is never contacted.
- **Magic-link flow.** 64-hex tokens, only `sha256` stored, 15-minute expiry, single use, explicit confirmation action (so email link-scanners do not consume it), deleted-address re-check at *both* request and verify time.
- **Account deletion.** Genuinely thorough: scrub, session revocation, pending-token revocation, entitlement deactivation, tombstone, audit row, and the `deleted_identities` guard that stops sign-in silently recreating the account. This is the most carefully reasoned feature in the codebase.
- **Cross-origin protection.** `csrf()` checks the `Origin` header on every mutating route (`route.ts:17`), with a permanent test.
- **Rate limiting** on email requests (per-address and global), actions, and downloads (`security.ts:12`, `route.ts:21,64,117`).
- **Upload validation.** Path traversal, absolute paths, backslash traversal, extension allow-list, and — unusually — *decompressed content* inspection so HTML-in-a-`.png` and script-in-a-`readme.txt` are refused. 17 tests. Correctly documented as "not antivirus".
- **CSP and security headers**, applied in `worker/index.ts` with a per-request nonce, header and markup nonces matching, no `unsafe-inline` for scripts or styles.
- **Secret handling.** Midtrans server key AES-256-GCM encrypted at rest, never sent to the browser; amount always recomputed server-side from the stored price.
- **Preview mode.** Without `DATABASE_URL` the store shows labelled samples, `/admin` is read-only, and indexing is off. Honest and safe.

---

## Priority order

1. `orders/refresh` cannot recover a `pending` order with no `checkout_url` (§2.2) — the customer is stuck.
2. Refund policy promises a process that does not exist, and `review` has no resolution path (§1.4) — plus the `CONTACT_EMAIL` placeholder.
3. No order/receipt email (§2.5).
4. Terms-acceptance is not recorded anywhere (§3.4), so the license is unprovable per customer.
5. Sign-in availability predicate disagrees between client and server (§2.1).
6. No timeout on any outbound `fetch` (§4) — turns clean errors into raw 5xx.
7. Order id not shown where the policy asks the customer to quote it (§2.7).
8. Operator identity, tax treatment, privacy contact (§3.1, 3.3, 3.6).
