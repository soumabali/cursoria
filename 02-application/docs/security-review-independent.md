# Cursoria — Independent Security Review

Scope: `02-application/app/api/[...path]/route.ts`, `lib/security.ts`, `lib/storage.ts`,
`lib/payments.ts`, `lib/db.ts`, `worker/index.ts`, `database/*.sql`, `tests/security.test.mjs`.
Method: read the current files, then exercised the real modules locally (TypeScript transpiled
and imported with only `next/headers`, `next/server`, and the DB/fetch boundaries stubbed).
No production writes, no deploys, no R2 uploads, no live-DB mutation. Live site was only read
via unauthenticated `GET` for header inspection.

Note: `app/api/[...path]/route.ts` changed on disk mid-review (120 → 142 lines; `orders/refresh`
gained an `openCheckout` helper). All findings below were re-verified against the 142-line
version. Existing suite: 17/17 pass.

---

## Findings

### 1. ZIP bomb: declared-size caps are defeated by lying central-directory entries — HIGH
**File:** `lib/storage.ts:22-27` (`validateZip`) vs `lib/storage.ts:42-82` (`inspectZipContents`).

`validateZip` enforces two limits using the **declared** uncompressed size from the central
directory: per-archive total `size > 100*1024*1024` (line 25) and per-member `usize > MAX_MEMBER`
(12 MB, line 51). Those declarations are attacker-chosen bytes in the file. `inspectZipContents`
then inflates the **real** deflate streams, which can be arbitrarily larger than declared.

Demonstrated locally: an archive of **5.77 MB on the wire** whose central directory declares
~0.48 MB total, containing 496 members that each declare `usize=1024` but actually inflate to
11.9 MB of text. `validateZip` **accepted** it and inflated **5.8 GB** of member data
(~2.4 s of pure inflate locally, ~5.8 GB of allocation churn). With `.txt` members of zeros
it aborts on the first member's NUL check, but text-safe filler (0x20) sails through all 496.

Why it matters: 20 MB is the accepted upload size (`route.ts:107-108`), so the wire cost of a
~6 GB inflate is ~6 MB. A creator account is the only gate (`requireUser('creator')`), and
creator accounts are handed out by the superadmin — but the superadmin can also create a
creator for anyone, and the Worker's CPU/memory budget is far below 6 GB, so this is a
denial-of-service primitive on the upload path (and, if it OOMs mid-request, on the isolate).

Fix: do not trust declared sizes. Bound the **actual** inflate output in `inspectZipContents`:
inflate with `zlib.inflateRawSync(raw, {maxOutputLength: MAX_MEMBER})` (throws on overflow),
cap the **running total** of real decompressed bytes across all members at ~100 MB, and
compute the declared total too. Also reject when `usize !== actualInflatedLength` for
method 8/0 — a legitimate ZIP's declared size always equals the real size, so this closes the
lie entirely and is the cheapest correct fix:
```ts
data = method===8 ? inflateRawSync(raw,{maxOutputLength:MAX_MEMBER}) : method===0 ? raw : raw;
if (method!==8 && method!==0) throw new Error('Invalid ZIP archive.');   // currently falls through to raw
if (data.length !== usize) throw new Error('Invalid ZIP archive.');
```
(Note `method===99` currently falls into the `else raw` branch and is only caught later by the
extension content check; treat unknown methods as invalid.)

### 2. `.txt` markup check is an incomplete blocklist — MEDIUM
**File:** `lib/storage.ts:71-77`.

The readme check only rejects `<script|html|iframe|object|embed|svg|form|meta|link>`. Confirmed
accepted: `.txt` containing `<math>`, `<details>`, `<video>`, `<audio>`, `<source>`, `<body>`,
`<div>`, and text containing a `javascript:` URL. `<math>` and `<details>` have real history as
XSS vectors, and this is a blocklist, so it is permanently one tag behind.

Why it matters: mitigation depends entirely on how a downloaded `.txt` is later opened. The app
itself never renders package contents (they are only streamed as `application/zip` with
`Content-Disposition: attachment` + `nosniff`, `route.ts:139`), so this is **not** currently a
stored-XSS path *through the app*. It is a "the ZIP you downloaded from us contains a file that
executes when opened" delivery concern — which is exactly what the comment claims to defend
against, so the claim is stronger than the check.

Fix: invert the test. Treat `.txt` as text only if it matches a conservative allowlist
(printable ASCII + `\t\n\r`, optionally UTF-8) and contains **no** `<` at all, or strip to
`[\x09\x0a\x0d\x20-\x7e]`. Rejecting any `<` in a readme is cheap and has no legitimate cost.
Do not extend the tag list.

### 3. `objectRequest` has no key guard; `..` traversal collapses the per-user prefix — MEDIUM
**File:** `lib/storage.ts:10`.

`url.pathname='/'+[bucket,...key.split('/')].map(encode).join('/')` lets WHATWG URL normalise
`..` segments. Confirmed: `objectRequest('GET','userid/../../victim/secret.zip')` sends and
**signs** `GET /victim/secret.zip` — the `bucket` prefix is dropped and the signature is valid
for the escaped path (verified against an independent SigV4 recomputation). So the prefix is
not a boundary at the signing layer.

Why it matters: **not currently exploitable.** Every key either comes from
`u.id+'/'+token()+'.'+ext` (`route.ts:110`, UUID + hex token — no `..` possible) or from a
`products.preview_key`/`package_key` that passed the `SELECT id FROM uploads WHERE
object_key=$1 AND (owner_id=...)` lookup (`route.ts:115`), which compares the exact string
against a key that itself could not contain `..`. So no path from user input reaches
`objectRequest` with a traversing key today. This is a defense-in-depth gap: any future caller
that signs a DB- or request-derived key becomes a cross-tenant R2 read/write. Given the prefix
exists specifically to isolate tenants, harden it:
```ts
if (key.split('/').some(s => s===''||s==='.'||s==='..')) throw new Error('Invalid object key.');
```
(and assert the final `url.pathname` still starts with `/${encode(bucket)}/`).

### 4. No per-IP limit on `auth/request`; deleted-vs-active addresses are distinguishable — LOW
**File:** `route.ts:34,39-40`.

Rate limiting is per-email (3/hr) and a single global key (100/hr). There is no per-IP or
per-ASN limit, so an attacker can mail-bomb many distinct victim addresses at 100/hr until the
global bucket is drained — which also starves legitimate sign-ins for everyone (a shared-bucket
DoS). The global cap does bound total Resend spend, so severity is low.

Separately, `auth/request` returns a distinct error for a deleted address
("...used for an account that has been deleted...") vs success for any other. That is an
enumeration oracle for "which addresses once had an account here". Low, but it is a
deliberate information leak in an otherwise uniform response path.

Fix (both cheap): add an IP key (`limit('ip:'+req.headers.get('cf-connecting-ip'),20)`) before
the email keys, and return the same generic "Check your inbox" message for deleted addresses
while still refusing to issue a token (log the refusal server-side).

### 5. `views` has no rate limit and trusts a client-supplied cookie — LOW
**File:** `route.ts:73-75`.

`views` is unauthenticated and unlimited. The visitor value is accepted as-is if it matches
`/^[0-9a-f]{64}$/`, so an attacker never has to earn a cookie — send `Cookie:
cursor_visitor=<random hex>` per request and every request is a fresh unique visitor. The PK is
`(product_id, visitor_hash, day)`, so this is exactly unbounded view inflation on any published
product.

Why it matters: metric integrity only — no data is read or written beyond counters.

Fix: `await limit('views:'+u-or-visitor, 60)` or a per-IP cap; or sign the visitor cookie so
the value cannot be minted client-side.

### 6. Code smell with a security edge: duplicated Snap call — LOW (maintainability)
**File:** `route.ts:16-24` (`openCheckout`) vs `route.ts:86-94` (inline copy in `checkout`).

The inline copy lacks the `AbortSignal.timeout(20000)` and the richer `item_details`
(`title`/`email`) that `openCheckout` gained. Divergent payment code paths are how
"the fix only landed in one branch" bugs happen. Route `checkout` through `openCheckout` too.

---

## What I checked and found SOUND

- **SQL injection — none.** All 14 `sql()` call sites use `$1..$n` bind parameters; zero
  template interpolation of user data. `lib/db.ts` posts `{query, params}` to Neon's endpoint,
  so parameters are bound, not concatenated. `hash()` output is always a hex string passed as a
  bind param.
- **Authorization / IDOR — holds on every route I tested.** `products/save` scopes
  ownership by `owner_id=$me OR $isSuperadmin`; a creator editing another creator's product gets
  "Product not found" (`route.ts:114`). Cross-creator `preview_key`/`package_key` reuse is
  rejected by the `uploads` ownership lookup (verified: referencing a foreign key →
  "Upload a valid product file"). `download` requires an active entitlement for *that* user and
  product (`route.ts:139`) and 403s otherwise. `orders/refresh` filters `o.user_id=$me`
  (`route.ts:98`) — a foreign order returns "Order not found". `settings/save` and `creators/save`
  require superadmin.
- **Privilege escalation — none found.** `creators/save` hard-codes `role='creator'` and guards
  `WHERE users.role<>'superadmin'`, so it cannot mint a superadmin or demote one
  (`route.ts:124`). The only superadmin grant is `auth/verify` promoting the account whose email
  equals `SUPERADMIN_EMAIL` (`route.ts:53`) — that email is server-side config, and reaching it
  requires receiving the magic link at that address, so it is not attacker-reachable.
- **Magic-link tokens.** 32 random bytes (256-bit) from `randomBytes`, stored **hashed**
  (sha256) and looked up by hash; the raw token never hits the DB. Single-use via
  `DELETE ... RETURNING` in the verify CTE (replaying a consumed token yields no row →
  "invalid or expired"). 15-minute expiry enforced in SQL (`expires_at>now()`). `next` is
  strictly matched against `^/products/[a-z0-9-]+$`, so **no open redirect** (tested
  `https://evil.com`, `//evil.com`, `/products/foo/../bar` → all coerced to `/dashboard`).
- **Sessions.** 256-bit token, sha256-at-rest, 7-day expiry checked in the session join,
  `httpOnly`, `sameSite=lax`, `secure` when the origin is https. `logout` deletes by hash.
- **Timing.** `equal()` is `length===length && timingSafeEqual` — constant-time on equal-length
  inputs; both operands in the Midtrans signature check are sha512 hex (fixed length), so the
  length branch leaks nothing. All secret comparisons (`login_tokens.hash`, `sessions.hash`) are
  done in SQL by equality on a hash, not in app code.
- **Rate limiter.** A single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING hits` — no
  read-then-write race; concurrent requests cannot both pass. Keys are the sha256 of the logical
  key, so raw emails are not stored.
- **CSRF.** `csrf(req)` requires `Origin` to exactly equal `APP_URL`; it runs before every
  authenticated handler. Tested: missing `Origin`, `http://`, wrong case, trailing slash,
  subdomain suffix (`store.example.evil.com`), and `null` are all rejected. Only
  `payments/webhook` bypasses it, by design, and is authenticated by Midtrans's sha512
  `signature_key` over `order_id+status_code+gross_amount+server_key`, checked before any
  network call (test line 60 proves the remote lookup is not reached on a forged signature).
- **Midtrans reconcile.** Authoritative `/v2/{id}/status` response is validated
  (`order_id`, `currency==='IDR'`, `gross_amount===o.amount`) before any entitlement change; a
  mismatched amount cannot grant access (test line 61). State transitions are monotonic
  (`paid` is not downgraded to `pending`/`failed`; refund moves to `refunded`), de-duplicated by
  `payment_events.event_hash`, and the write is one `FOR UPDATE`-locked statement.
- **Payment-key encryption.** AES-256-GCM, 12-byte random IV per call, GCM tag verified on
  decrypt (tampering rejected), key must be exactly 64 hex chars or `encrypt` throws. The
  decrypted key is used only in the server→Midtrans `Authorization` header and is never returned
  to the client (verified `orders/refresh` response: no key material).
- **WASM-free SigV4 itself is correct.** Independently recomputed the signature for the exact
  request the code sends — matches byte-for-byte. `x-amz-date` is the right format
  (`YYYYMMDDTHHMMSSZ`, no millis), `x-amz-content-sha256` is the true body hash (and the empty-body
  constant for GET), scope/credential/signed-headers are right, and HTTPS is enforced
  (`url.protocol!=='https:'` throws). Finding #3 is about key handling, not the signing math.
- **CSP is real and effective (live-verified).** `content-security-policy` is present on HTML
  *and* API responses; `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self'` with
  **no** `unsafe-inline`, plus `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`,
  `form-action 'self'`. The nonce is 16 random bytes from `crypto.getRandomValues`, **fresh per
  request** (two GETs → two different nonces), set on the inbound request so vinext's renderer
  stamps the same value on its bootstrap tags, and overwritten server-side so a client-supplied
  `Content-Security-Policy` header cannot influence it. Every `<script>` in the served HTML
  carries the matching nonce; zero inline event handlers; zero `style=` attributes; zero inline
  `<style>` tags. `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`,
  `referrer-policy`, and `permissions-policy` all present.
- **XSS sinks — none with user data.** The only `dangerouslySetInnerHTML` uses are static
  strings (the research page and an **unused** vendored chart component). The JSON-LD block on
  the product page escapes `<` → `\u003c` before injection, so `</script>` breakout is
  impossible. Everything else is React-escaped text.
- **Account deletion — the flow is sound and the previously-fixed holes are genuinely closed.**
  - Not CSRF-able (origin check runs first); not cross-user (`WHERE id=$u.id`); requires typing
    the account's own email (`route.ts:66`, case-insensitive both sides); requires a verified
    session.
  - The whole operation is **one** SQL statement (blocked/scrubbed/revoked/revoked_tokens/dropped
    CTEs), so it commits atomically or not at all — no partial-deletion state. Verified the exact
    parameters: `deleted_identities` gets `sha256(lower(email))`, matching the hash used in
    `auth/request` and `auth/verify` (I computed all three and they are identical), so a deleted
    address is refused at **both** sign-in entry points — including a link issued *before*
    deletion, which `auth/verify` re-checks. The earlier `ON CONFLICT(email)` resurrection is
    closed.
  - Sessions and live login tokens are revoked and the cookie is cleared. Entitlements are
    deactivated, so purchased downloads stop. `orders` survive as anonymised financial records
    (FK topology requires the row to stay), and `audit_log` records the tombstone, not the
    original address.
  - Cannot lock out a rightful user: the tombstone is `deleted+<hash16>@invalid` and the row is
    `disabled=true`, so no other address can collide.

---

## Could not verify (and why)

- **Neon endpoint behaviour.** `lib/db.ts` sends the connection string as a header to
  `https://<host>/sql`. I could not test the live endpoint without touching production, and the
  accepted-query/transaction semantics (whether a multi-CTE statement is one implicit
  transaction) are Neon's, not the app's. The code's use of a single statement for the deletion
  is the right shape; confirm atomicity with Neon's docs if you want it proven.
- **R2/S3 signature acceptance.** I verified the signature matches an independent recomputation
  of the *same* request, which is the strongest check possible without a real bucket. Whether R2
  additionally rejects the `..`-collapsed path (some S3 implementations normalise, some reject)
  is environment-specific — which is another reason to fix finding #3 in code rather than rely on
  it.
- **Live CSP enforcement by a browser.** I confirmed the header and the nonce-bearing markup, not
  an actual browser refusing an injected inline script.
- **Midtrans Sandbox.**
- **The retention job** referenced by `002_account_deletion.sql` ("what the retention job uses to
  find accounts that have been dormant long enough to purge their remaining traces") does not
  exist in `database/maintenance.sql`, which only deletes expired tokens/sessions/rate-limit rows.
  The comment promises a purge that no code performs. Not a vulnerability — the anonymisation is
  already done at deletion time — but the comment overstates what ships.
- **Files changed mid-review.** `route.ts` was edited while I read it; I re-ran every probe
  against the 142-line on-disk version, but if further edits land, findings #1–#6 should be
  re-checked (in particular anything touching `inspectZipContents` or `objectRequest`).

---

## Bottom line

The security-critical logic — authorization, SQL handling, token/session design, payment
reconciliation, CSP, and the account-deletion flow — is genuinely sound and I could not break it.
The one finding worth acting on before anything else is **#1 (ZIP bomb / declared-size lie)**,
because it is a reachable, cheap DoS with a one-line-ish fix. **#2** and **#3** are real
weaknesses whose impact is currently contained by other layers; fix them so the containment is
not load-bearing. **#4–#6** are low-severity hygiene.
