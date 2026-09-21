# Session - R2 storage: scripts ready, blocked on token

Date: 2026-09-21
Project: Cursoria / "Cursor Studio"

## Goal
Configure Cloudflare R2 so uploads, previews, and paid downloads work.

## Outcome: BLOCKED on a credential only Dhar can create

The environment's `CLOUDFLARE_API_TOKEN` is an account-wide deploy
token. It fails R2 on every route with HTTP 403
`Authentication error [code: 10000]`:

  GET  /accounts/<id>/r2/buckets      -> 403
  POST /accounts/<id>/r2/buckets      -> 403

It verifies as active and can read `/accounts` and `/zones`, so it is
a permissions gap on R2 specifically, not a broken token. The same
token cannot mint an R2 S3 credential either.

Searched for existing R2 credentials: none exist. `~/.hermes/.env` has
no R2/S3/AWS keys, and the Obsidian vault has no Cloudflare or R2
credential note (only Github, OmniRoute, RustDesk, sample-app, vexa).

## What is ready (committed, faa88ee)

- `scripts/setup-r2.sh` - creates the private bucket `cursoria-packs`
  and pushes S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID /
  S3_SECRET_ACCESS_KEY / S3_REGION to the Worker. Takes the R2-scoped
  token from `R2_API_TOKEN`; it does not read or reuse the deploy
  token. Exits with instructions if the API cannot mint an S3
  credential.
- `scripts/push-worker-secret.sh` - pipes values through stdin so they
  never land in the process table. Verified by pushing S3_REGION=auto.

## What Dhar must create

Option A - R2 API token (dashboard):
Cloudflare dashboard > R2 > Manage API Tokens > Create API token,
permission "Object Read & Write", scoped to the `cursoria-packs`
bucket. Then:

  R2_API_TOKEN=<token> R2_BUCKET=cursoria-packs \
    bash scripts/setup-r2.sh

Option B - create the bucket and token by hand, then push the five
secrets with scripts/push-worker-secret.sh. Endpoint is
`https://<account_id>.r2.cloudflarestorage.com`, region `auto`.
Do not make the bucket public; the app streams authorized downloads.

## Verified in the meantime

The AWS SigV4 signing path in `lib/storage.ts` was exercised against a
local S3 stand-in with the real signing code. Result: correct
canonical path `/cursoria-packs/<key>`, credential scope
`<access>/<date>/auto/s3/aws4_request`, the three signed headers
present, and the x-amz-content-sha256 hash matching the body. So once
the credentials exist, uploads and downloads should work without a
code change.

## Worker secrets now (7)

APP_URL, DATABASE_URL, EMAIL_API_KEY, EMAIL_FROM, S3_REGION,
SETTINGS_ENCRYPTION_KEY, SUPERADMIN_EMAIL.

S3_REGION is set but inert until the other four S3_* secrets land
(`objectRequest` throws "File storage is not connected yet." when any
of endpoint/bucket/access/secret is missing).

## Unchanged blockers

Midtrans Server Key (payment_settings still empty), 0 products,
policies still a draft, no git remote, STORE_PUBLIC unset.
