# Session - Open tasks audit (state verified)

Date: 2026-09-21
Project: Cursoria / "Cursor Studio" (cursoria.nexigo.my.id)

## Goal
Report exactly which tasks remain open, verified against live
production, not against notes.

## Evidence gathered

Prod routes (curl): / 200, /guide 200, /policies 200, /signin 200,
/research 200, /dashboard 200, /admin 307 -> /signin (correct),
/sitemap.xml 200, /robots.txt 200. Homepage title
"Cursor Studio — Make every click more you". Catalog page renders
"0 packs to make your own" + "No packs found".

Worker secrets (wrangler secret list --name cursoria):
APP_URL, DATABASE_URL, EMAIL_API_KEY, EMAIL_FROM,
SETTINGS_ENCRYPTION_KEY, SUPERADMIN_EMAIL. No S3_* keys.

Prod DB (NEON_PROJECT_CURSOR_PRODUCTION_URL):
tables audit_log, entitlements, login_tokens, orders,
payment_events, payment_settings, product_views, products,
rate_limits, sessions, uploads, users.
  users            1  (sudhar.denpasar@gmail.com, superadmin, verified)
  products         0
  orders           0
  entitlements     0
  payment_events   0
  payment_settings 0  <- EMPTY: no Midtrans key stored
  product_views    0
  uploads          0
  sessions         1  (Dhar's signed-in magic-link session, valid
                       to 2026-09-27)

Cloudflare API token can read /accounts but R2 list returns 403
Authentication error -> even if a bucket exists, the token cannot
see it, and the Worker has no S3_* secrets at all.

## Task board

### Blocked / needs Dhar
1. R2 bucket + scoped token + 4 S3_* Worker secrets. Uploads,
   paid downloads, preview images cannot work without it
   (lib/storage.ts throws "File storage is not connected yet.").
2. Midtrans Server Key at /admin/settings, sandbox production=false,
   then webhook <APP_URL>/api/payments/webhook must be reachable
   (owner-private preview rejects it).
3. Real cursor packs: none in prod. Store is unusable with 0 products.
4. Store policies are a draft outline: operator identity, support
   contact, refund process, data retention still missing.
5. Git remote: still none. GitHub auth is account soumabali;
   token needs Contents: Read/Write for the push.
6. STORE_PUBLIC=true only after 3 and 4. Confirm robots.txt
   currently Disallow: / (yes) and metadata noindex.

### Ready to execute now
7. Deploy the lint-cleanup commit (6eb1f8b). Prod still serves the
   pre-fix build; nothing has been deployed since 2026-09-20T17:24Z.
8. Bootstrap: after the superadmin exists, SUPERADMIN_EMAIL should
   be cleared per README step 5, otherwise a later sign-in from that
   address re-applies the superadmin CASE in the account upsert.
9. Browser/E2E check of the sign-in loop, admin editor, preview
   upload and download path (never done).

### Follow-up queue (no blocker, after 1-4)
10. Creator payout flow (manual today), order export/pagination.
11. Malware scanning on uploaded ZIPs before a large public launch.
12. Nonce-based CSP + independent security review.
13. Full accessibility audit (W3C target-size was applied, no
    conformance audit performed).
14. Verify product JSON-LD + sitemap in Rich Results Test after the
    public launch.
