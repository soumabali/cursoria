# Session — independent reviews, ZIP bomb, and the fixes they produced

Date: 2026-09-21
Project: Cursoria / "Cursor Studio"

Both reviews I could not honestly do myself were delegated to fresh-context
reviewers. Both returned real findings. Almost everything below came from
them, and the most important lesson is about how their reports were verified.

## Security review

Report: `02-application/docs/security-review-independent.md`.

Confirmed sound: SQL injection (all 14 call sites use bind parameters),
authorization and IDOR on every route, privilege escalation, magic-link and
session design, CSRF origin checking, Midtrans reconcile (signature, amount
and currency pinning, atomic locked update, event dedupe), AES-256-GCM key
handling, the SigV4 signing itself, the nonce CSP, and the account-deletion
flow including the `deleted_identities` guard.

Real findings, fixed:

1. **ZIP bomb — HIGH, and it was live.** Declared-size limits are satisfied by
   the archive lying about its own contents. A 0.25 MB upload hung the Worker
   past 60 s (curl `000`, measured) and left the site intermittently
   unresponsive afterwards. `wrangler tail` showed the Worker logging "Ok" for
   every request it received, which is what proved the app was fine and the
   hang was real work, not a routing problem.
2. `.txt` markup check was a tag blocklist — permanently one tag behind.
   Now an allowlist: any `<` is refused.
3. `objectRequest` had no key guard; `..` collapses under URL normalisation
   and drops the bucket prefix. Not exploitable today, fixed so the
   containment is not load-bearing.
4. No per-IP limit on `auth/request` (mail-bomb + shared-bucket DoS), and a
   deleted-vs-active address was distinguishable. Both fixed; the refusal now
   answers identically to a normal request.
5. `views` was unlimited and trusted a shape-checked cookie, so view counts
   were inflatable. Now rate-limited per IP.
6. The inline Snap call in `checkout` had drifted from `openCheckout` (no
   timeout, different item details). Both now share one function.

Also added a timeout to every outbound fetch (Neon, Resend, Midtrans, R2) —
previously none had one, so a hung dependency produced a raw 5xx instead of
the considered error message each path already had.

## The ZIP bomb: two fixes that did not work, and why

Worth writing down because the intuitive fix fails in a way tests cannot see.

1. `inflateRawSync(raw,{maxOutputLength:MAX})` is correct and **Node honours
   it** — verified, it throws `ERR_BUFFER_TOO_LARGE`. The **Workers
   `node:zlib` shim silently ignores the option**, so the bound held in the
   test suite and not in production. The local validator rejected the exact
   archive in 5 ms while the deployed worker hung on the same bytes.
2. A declared-size or expansion-ratio check **cannot** catch this bomb. The
   archive declares a size *smaller* than reality (`usize` 1 KB for a member
   that inflates to 2 MB), so its ratio is 0.5 and every number in it looks
   reasonable. Bounding what the attacker claims is meaningless.
3. The stream API is not an option either: `createInflateRaw` emits its data
   asynchronously, so a synchronous validator sees an empty buffer.

What works: check the per-member declared size **before** decompressing, so a
member claiming more than the cap is refused without inflating anything, then
measure the real output. The allocation is then bounded by the cap rather than
by the archive. Result: 400 "Invalid ZIP archive." in 0.12–0.25 s, three times
in a row, where it previously hung past 60 s.

**The general lesson: a security bound that is only verified in the Node test
runner is not verified. This passed 20/20 locally while production was
vulnerable. Test the deployed runtime for anything that depends on a platform
API, and treat a local pass as evidence about Node, not about production.**

## Second opinion on my own testing

I reported the bomb "fixed" twice before it was. Both times my evidence was a
local test run. The signal that it was not fixed was production behaviour
contradicting a local pass on byte-identical input — that contradiction is a
stronger signal than any number of green tests, and it should have stopped me
sooner than it did.

## Unrelated discovery, not a bug

Repeated `000` responses while testing looked like a site outage. They are
not: `/api/*` and the Worker logs answered normally throughout, and **both**
Cloudflare-fronted hosts fail identically from this machine with TLS handshake
timeouts and an edge `403`, while GitHub is unaffected. That is Cloudflare
filtering this host's automated traffic, not the store.

## Product/ops review

Report: `02-application/docs/policy-accuracy-and-launch-readiness-review.md`.
Fixes applied are in the previous commit. The one that mattered to a real
customer: a pending order with no `checkout_url` could never be paid, because
`orders/refresh` only reconciled a transaction that had never been created.

## Verification

Gate every deploy: tsc clean, eslint 0, **20/20** security tests, build OK.
Production: bomb refused 400 (0.12–0.25 s, 3/3), genuine pack 200, DB back to
one superadmin row, R2 empty.
