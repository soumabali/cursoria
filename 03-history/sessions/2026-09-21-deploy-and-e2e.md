# Session - Deploy lint build, E2E verification, admin 500 bugfix

Date: 2026-09-21
Project: Cursoria / "Cursor Studio" (cursoria.nexigo.my.id)

## Goal
Execute the ready items from the open-tasks audit: deploy the
lint-cleanup commit, retire the stale SUPERADMIN_EMAIL bootstrap,
and run the first real browser/E2E pass.

## 1. Deploy (was pending since 2026-09-20T17:24Z)

Pre-deploy gates, all green on the dev host:
- eslint 0 errors / 0 warnings
- tsc --noEmit clean
- test:security 12/12
- vinext build complete

Deploy command that works (no wrangler.toml in the repo):
  npx wrangler deploy --name cursoria --config dist/server/wrangler.json

The generated config is `dist/server/wrangler.json` (worker name
`cursor-studio`, `no_bundle: true`, assets `../client`). Overriding
with `--name cursoria` matches the existing Worker. Do NOT pass
`--assets` on the CLI: it resolves relative to CWD and expects
`./client`, which does not exist; the config already points at
`dist/client`.

Version IDs: 388df5c5 (initial), 0e9b658b (after the admin fix).

## 2. BUG FOUND AND FIXED - /admin overview 500

Symptom: signed-in superadmin hitting /admin got the error boundary
("We could not load this page. The store may be temporarily
unavailable."), while /admin/products, /admin/orders,
/admin/creators and /admin/settings were fine. Because the overview
is the parent of its own section, /admin itself was unusable.

Root cause: the revenue-chart query aliased a computed column to a
bare `day`:

  SELECT to_char(d.day,'DD Mon') day, ...

Neon's HTTPS SQL endpoint (`https://<host>/sql`) rejects `day` as a
standalone alias with PostgreSQL 42601 `syntax error at or near
"day"`. Every generated column alias in this codebase must avoid
bare reserved words, even though the same SQL is accepted by psql.

Confirmed by replaying each admin query verbatim over the HTTP
endpoint: products/creators/payment_settings/orders/metrics/
performance all OK, `daily` FAIL, and the same query with
`AS dlabel` OK.

Fix: alias renamed to `dlabel` in the SQL plus the five template
references (chart aria-label, bar key, bar title, caption first/last
day). tsc clean, lint clean, 12/12 tests, rebuilt and redeployed.

## 3. E2E verification (first real browser pass, all against prod)

Public:
- / 200, catalog renders, filters present (All packs, Soft & cozy,
  Cute characters, Pixel art, Nature, Minimal; price select; sort;
  Reset filters)
- 0 products -> "No packs found" empty state with reset (correct)
- unknown slug /products/matcha-moments -> not-found page (correct:
  sample concepts are preview-only and not routable over DB mode)
- /guide /policies /research /signin 200
- /admin signed-out -> 307 to /signin (correct)

Auth loop (real magic link, Resend):
- POST /api/auth/request created a login_tokens row with a 15-minute
  expiry
- /verify?token=... rendered the "One last step" confirm page
- confirming consumed the token, set cursor_session, redirected to
  /dashboard
- /dashboard shows the email as verified, Creator studio link, order
  history, and no orders (correct)

Admin (post-fix, superadmin session):
- /admin overview renders stats, empty revenue chart, product table
- /admin/products -> "No products yet"
- /admin/orders -> "No orders yet"
- /admin/creators -> creator form + empty table
- /admin/settings -> environment select (sandbox/production),
  Server Key field, notification URL
- notification URL is correct:
  https://cursoria.nexigo.my.id/api/payments/webhook
- /admin/new renders the full pack form (name, slug, description,
  category, pricing model, price, platform, formats, states, version,
  preview image, package ZIP, license, rights checkbox, publish)

Access control:
- /api/download with a verified session but no entitlement returns
  {"error":"Not found."} (correct - no leak)

## 4. Not done / blockers unchanged

- SUPERADMIN_EMAIL: still present IN CODE by design (the upsert CASE
  needs it to bootstrap). Leave the Worker secret set until a
  non-superadmin account exists, otherwise a future sign-in from that
  address would create the user with role='user' and lock the owner
  out of /admin. Removing the secret is only safe together with a
  code change that promotes an existing account instead.
- R2/S3: still unconfigured. Upload of preview/package from
  /admin/new will fail at lib/storage.ts until the 4 S3_* secrets
  exist.
- Midtrans: payment_settings is still empty, so checkout throws
  "Payments are not available yet."
- 0 products, policies still a draft, no git remote, STORE_PUBLIC
  still unset (robots.txt correctly Disallow: /).

## Commits
388df5c5 / 0e9b658b  Worker deploys
86a28c6  fix: admin overview 500 from reserved SQL alias
