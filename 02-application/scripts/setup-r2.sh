#!/usr/bin/env bash
# Configure Cursoria's S3-compatible (Cloudflare R2) object storage.
#
# IMPORTANT: the Cloudflare API cannot mint permanent R2 S3 keys. Only the
# dashboard can (R2 > Manage R2 API Tokens > Create API token). The
# temporary-credential endpoint requires an existing parent access key and
# caps TTL at 7 days, so it is unsuitable for this store.
#
# Usage:
#   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... bash scripts/setup-r2.sh
#
# Optional overrides: R2_BUCKET      (default cursoria-packs)
#                     R2_ACCOUNT_ID  (default CLOUDFLARE_ACCOUNT_ID)
#                     R2_API_TOKEN   (only needed to create the bucket)
#
# Dashboard steps for the token:
#   Cloudflare dashboard > R2 > Manage R2 API Tokens > Create API token
#   Permission:   Object Read & Write
#   Bucket scope: cursoria-packs (not all buckets)
#   TTL:          leave blank (permanent)
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

account_id="${R2_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-}}"
: "${account_id:?Set R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID}"
bucket="${R2_BUCKET:-cursoria-packs}"
worker="${CURSORIA_WORKER:-cursoria}"
endpoint="https://$account_id.r2.cloudflarestorage.com"

echo "Account:  $account_id"
echo "Bucket:   $bucket"
echo "Endpoint: $endpoint"

# 1. Ensure the bucket exists. Needs an R2-edit API token; the S3 keys
#    below cannot create buckets.
# A token scoped only to a bucket's objects (the usual R2 API token
# created alongside the S3 keys) cannot list or create buckets. That is
# not an error here: the bucket already exists or the operator created
# it in the dashboard. Warn and continue rather than aborting, so the
# secrets still get pushed.
if [[ -n "${R2_API_TOKEN:-}" ]]; then
  echo "==> Checking bucket via API"
  existing="$(curl -sS -m 25 \
    "https://api.cloudflare.com/client/v4/accounts/$account_id/r2/buckets" \
    -H "Authorization: Bearer $R2_API_TOKEN" -H 'Content-Type: application/json')"
  if printf '%s' "$existing" | grep -q "\"name\":\"$bucket\""; then
    echo "    bucket already exists"
  elif printf '%s' "$existing" | grep -q '"success":true'; then
    created="$(curl -sS -m 25 -X POST \
      "https://api.cloudflare.com/client/v4/accounts/$account_id/r2/buckets" \
      -H "Authorization: Bearer $R2_API_TOKEN" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$bucket\"}")"
    if printf '%s' "$created" | grep -q '"success":true'; then
      echo "    created"
    else
      echo "    could not create bucket:" >&2
      printf '%s' "$created" | head -c 400 >&2
      echo >&2
      exit 1
    fi
  else
    echo "    token cannot list buckets (S3-scoped only); assuming"
    echo "    '$bucket' already exists. Verify in the R2 dashboard."
  fi
else
  echo "==> Skipping bucket check (R2_API_TOKEN not set)"
  echo "    Ensure bucket '$bucket' exists in the R2 dashboard."
fi

# 2. Collect the S3 keys. These come from the dashboard only.
if [[ -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  cat >&2 <<'EOF'

Missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.

Permanent R2 S3 credentials cannot be created through the Cloudflare API;
they are dashboard-only. Create them at:

  Cloudflare dashboard > R2 > Manage R2 API Tokens > Create API token
    Permission:   Object Read & Write
    Bucket scope: cursoria-packs
    TTL:          leave blank (permanent)

Then rerun with the two values:

  R2_ACCESS_KEY_ID=<id> R2_SECRET_ACCESS_KEY=<secret> bash scripts/setup-r2.sh

EOF
  exit 64
fi

# 3. Push the Worker secrets. Values travel through stdin so they never
#    appear in the process table.
echo "==> Pushing Worker secrets"
"$project_root/scripts/push-worker-secret.sh" S3_ENDPOINT "$endpoint"
"$project_root/scripts/push-worker-secret.sh" S3_BUCKET "$bucket"
"$project_root/scripts/push-worker-secret.sh" S3_ACCESS_KEY_ID "$R2_ACCESS_KEY_ID"
"$project_root/scripts/push-worker-secret.sh" S3_SECRET_ACCESS_KEY "$R2_SECRET_ACCESS_KEY"
"$project_root/scripts/push-worker-secret.sh" S3_REGION "auto"

echo
echo "Done. Verify with:"
echo "  npx wrangler secret list --name $worker"
