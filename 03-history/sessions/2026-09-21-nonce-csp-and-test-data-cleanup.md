# Session - Nonce CSP + production test-data cleanup

Date: 2026-09-21
Project: Cursoria / "Cursor Studio"

## 1. Production test data removed

Inventory first, delete second, with a backup written to
`/tmp/cursoria-backup/*.json` before anything was touched.

Removed:
- product `matcha-moments` (d974cf80-e5ba-475f-b9d9-fe2aeaa05ad4)
- 4 `uploads` rows
- 1 `orders` row (Rp0, paid)
- 1 `entitlements` row
- 1 `audit_log` row (`product.save`)
- 3 `product_views`
- 4 R2 objects under `cursoria-packs/b2100b5f-.../` (119-172 bytes each)

**Deliberately kept:** the user account `sudhar.denpasar@gmail.com`
(superadmin, verified, not disabled). It is Dhar's own login and the
only account; deleting it would have locked him out of his own store.
Checked explicitly after the deletes.

Also deleted the one preview upload created while verifying the CSP.
Final state: products 0, uploads 0, orders 0, entitlements 0,
audit_log 0, product_views 0, users 1. Bucket object count 0.

The DB is Neon Postgres reached over its HTTPS `/sql` endpoint (see
`lib/db.ts`), not Cloudflare D1 - the generated wrangler config has
empty `d1_databases` and the D1 binding path is vestigial. Queried via
`/tmp/neonq.mjs`, which mirrors the app's own request format.

## 2. Nonce-based CSP

`script-src` no longer allows `'unsafe-inline'`. Mechanism:

1. Worker generates a fresh 16-byte nonce per request
   (`crypto.getRandomValues`, base64).
2. It puts `'nonce-<value>'` on the CSP of the **incoming** request.
3. vinext's renderer reads the nonce back out of the request headers and
   stamps the same value onto the bootstrap and font `<script>`/`<style>`
   tags it emits.
4. `'strict-dynamic'` propagates trust to scripts the bootstrap loads.

The previous code comment claimed a nonce "would have to be threaded
through every render" - that was wrong. vinext supports request-header
nonces natively, so this was a small change rather than a framework
patch. Worth remembering: check the framework before writing off a
security improvement as infeasible.

### Bug found along the way: two conflicting CSP sources

`next.config.ts` still declared the old static CSP. The header it set
was applied on **API routes**, overriding the Worker's nonce policy,
so `/api/auth/verify` advertised `script-src 'self' 'unsafe-inline'`
while the document carried a nonce. The header was publishing a weaker
policy than the page enforced. Removed the `headers()` block entirely -
headers now have exactly one source of truth in `worker/index.ts`.

### Verification on production

- Header nonce and HTML nonce match on the same request
  (`tu12h7w67wJoUwT21ZD9Bg==`, captured from one curl with `-D`)
- Nonces rotate per request (3 fetches, 3 distinct values)
- All script tags nonced: 7-9 depending on page
- **Zero CSP violations** on `/`, `/verify`, `/dashboard`, `/admin`,
  `/admin/new`, `/admin/settings`, `/admin/orders`
- React hydration intact: controlled inputs accept dispatched events,
  checkboxes toggle
- `/api/uploads` still returns 200 under the new policy

### A testing mistake worth recording

I initially tested sign-in at `/signin?token=...` and concluded auth was
broken. The token actually belongs on `/verify?token=...`
(`app/verify/page.tsx`), and that page renders a button that must be
clicked - it does not auto-submit. Re-run correctly, the full flow
works: cookie set, redirect to `/dashboard`. The app was fine; the test
was wrong. Check the route the app actually emails before declaring a
regression.

## Deploy

455e20ac (nonce CSP + single header source)

## Commit

a6b4922  security: nonce-based CSP; remove duplicate header source

## Remaining, deliberately not faked

- `style-src` keeps `'unsafe-inline'`: the app uses inline `style=`
  attributes, which a nonce cannot authorise (nonces cover `<style>`
  elements, not attributes). Needs migration to classes.
- Independent security review
- ZIP malware scanning before a wider launch
