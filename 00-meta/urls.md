# Cursoria — URLs

> Single source of truth untuk domain dan endpoint.

## Production

| Service | URL | Hosting |
|---------|-----|---------|
| Store | https://cursoria.nexigo.my.id | CF Worker |
| Fallback | https://cursoria.sudharmika.workers.dev | CF Worker |

## Database (Neon PostgreSQL)

| Env | Neon Host (pooler) |
|-----|--------------------|
| production | ep-fragrant-water-b3b88nag-pooler |
| development | ep-old-fog-b3mmhwdq-pooler |

Connection URLs live in the secret manager, not here. Locally they are
`NEON_PROJECT_CURSOR_PRODUCTION_URL` / `..._DEVELOPMENT_URL` in
`~/.hermes/.env`; in the Worker they are the `DATABASE_URL` secret.

## Cloudflare Resources

| Resource | Nilai |
|----------|-------|
| Account ID | 81e5bd15a7810cb281f887efa5f0f4d0 |
| Worker | cursoria |
| Zone | nexigo.my.id |

## Worker secrets (production)

APP_URL, DATABASE_URL, EMAIL_API_KEY, EMAIL_FROM,
SETTINGS_ENCRYPTION_KEY, SUPERADMIN_EMAIL.

Not yet set: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID,
S3_SECRET_ACCESS_KEY, S3_REGION (needed for uploads and downloads),
STORE_PUBLIC (indexing stays off until the catalog is real).

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| /api/payments/webhook | Midtrans notification URL (set this in the Midtrans dashboard) |
| /api/download | Authenticated, entitlement-gated ZIP stream |
| /api/preview/:key | Published preview images |
| /verify?token=... | Magic-link confirmation |
