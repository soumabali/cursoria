# Session - R2 storage live; full catalog-to-download loop verified

Date: 2026-09-21
Project: Cursoria / "Cursor Studio" (cursoria.nexigo.my.id)

## Outcome: object storage is LIVE and the whole purchase chain works

Credentials came from `~/.hermes/.env`:
  NEXIGO_R2_TOKEN             (R2 API token, object-scoped)
  NEXIGO_R2_ACCESS_KEY_ID     (32 hex)
  NEXIGO_R2_SECRET_ACCESS_KEY (64 hex)

Bucket: `cursoria-packs` (APAC, Standard, private).

## Credential probe before wiring anything

Ran a SigV4 PUT/GET/DELETE probe with the real key pair against
`https://<account>.r2.cloudflarestorage.com`:
  PUT 200, GET 200 (body matched), DELETE 204.
Only then were the secrets pushed.

## Worker secrets now (11)

APP_URL, DATABASE_URL, EMAIL_API_KEY, EMAIL_FROM, S3_ACCESS_KEY_ID,
S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_SECRET_ACCESS_KEY,
SETTINGS_ENCRYPTION_KEY, SUPERADMIN_EMAIL.

## Note on the token: object-scoped, not bucket-admin

`NEXIGO_R2_TOKEN` cannot list or create buckets:
`GET /accounts/<id>/r2/buckets` -> 403 code 10000. That is expected for
an R2 token created alongside the S3 keys. `scripts/setup-r2.sh` used
to abort on that and never pushed the secrets; it now warns and
continues, because the bucket is verified separately.

Deploying the Worker and managing buckets still uses
`CLOUDFLARE_API_TOKEN`, which is unaffected.

## Live end-to-end verification (all against production)

1. Upload a preview PNG through /admin/new -> "Preview attached",
   "Preview uploaded. Save the product to attach it."
2. Upload a valid ZIP package -> "ZIP attached", "ZIP uploaded."
3. Confirmed in R2 with the real keys:
   GET object -> 200, content-type image/png, 119 bytes,
   PNG magic 89504e470d0a1a0a. So the file is physically in the bucket.
4. Published a pack ("Matcha Moments", free, Soft & cozy) -> row in
   products with published=true, preview_key and package_key set,
   audit_log entry product.save/matcha-moments.
5. Public storefront: / shows "1 pack to make your own" and the card
   (FREE PACK, Soft & cozy, 15 cursors). Product page renders with
   compatibility, formats, states, version, and license.
6. Preview image on the product page loads from /api/preview/<id> with
   naturalWidth 32x32 (decoded, not a broken image), content-type
   image/png, 119 bytes.
7. Access control: /api/download/<id> without a session -> 403
   "Sign in with a verified email to continue."
8. Free claim: clicking "Add to My Library" created an order
   (amount 0, status paid) and an active entitlement, and redirected
   to My Library, which now lists the pack with "Download ZIP".
9. Download: GET /api/download/<id> with the session -> 200,
   content-type application/zip,
   content-disposition attachment; filename="matcha-moments.zip",
   172 bytes, ZIP magic 504b0304.

That is the complete chain: upload -> R2 -> publish -> public page ->
claim -> entitlement -> authenticated ZIP download.

## Test data now in production

One real published product: "Matcha Moments" (free, slug
matcha-moments), plus 4 uploads rows and 1 paid order (Rp0) and 1
entitlement for the owner account. These are genuine artifacts of the
verification, not samples. Delete them before opening the store if a
clean catalog is wanted; there is no delete UI for products.

## What this unblocks

The store can now accept packs. Remaining before a public launch:
Midtrans Server Key at /admin/settings (payment_settings still empty),
real pack content, and the store policies text. Then set
STORE_PUBLIC=true.

## Commits
f553726  chore: r2 setup tolerates object-scoped tokens
6f3b8f9  chore: setup-r2.sh documents dashboard-only S3 key creation
