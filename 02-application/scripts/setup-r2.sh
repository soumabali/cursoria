#!/usr/bin/env bash
# Configure Cursoria's S3-compatible (Cloudflare R2) object storage.
#
# Needs an R2-scoped Cloudflare API token (see .env.example / README).
# The account-wide CLOUDFLARE_API_TOKEN used for deploys does NOT have R2
# permissions, so it cannot be reused here.
#
# Usage:
#   R2_API_TOKEN=... bash scripts/setup-r2.sh
#
# Optional overrides: R2_BUCKET (default cursoria-packs),
#                     R2_ACCOUNT_ID (default CLOUDFLARE_ACCOUNT_ID)
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

: "${R2_API_TOKEN:?Set R2_API_TOKEN to a Cloudflare token with Workers R2 Storage: Edit}"
account_id="${R2_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-}}"
: "${account_id:?Set R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID}"
bucket="${R2_BUCKET:-cursoria-packs}"
worker="${CURSORIA_WORKER:-cursoria}"

api() { # method path [json-body]
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "Authorization: Bearer $R2_API_TOKEN" \
      -H 'Content-Type: application/json' -d "$data"
  else
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "Authorization: Bearer $R2_API_TOKEN" -H 'Content-Type: application/json'
  fi
}

json_field() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null || echo ""; }

echo "Account: $account_id"
echo "Bucket:  $bucket"

echo "==> Ensuring bucket exists"
existing="$(api GET "/accounts/$account_id/r2/buckets")"
if [[ "$(printf '%s' "$existing" | json_field "['success']")" != "True" ]]; then
  echo "R2 API rejected the token:" >&2
  printf '%s' "$existing" | head -c 400 >&2
  echo >&2
  exit 1
fi
if printf '%s' "$existing" | grep -q "\"name\":\"$bucket\""; then
  echo "    bucket already exists"
else
  created="$(api POST "/accounts/$account_id/r2/buckets" "{\"name\":\"$bucket\"}")"
  if [[ "$(printf '%s' "$created" | json_field "['success']")" != "True" ]]; then
    echo "    could not create bucket:" >&2
    printf '%s' "$created" | head -c 400 >&2
    echo >&2
    exit 1
  fi
  echo "    created"
fi

echo "==> Creating bucket-scoped S3 credential"
cred="$(api POST "/accounts/$account_id/r2/temp-access-credentials" '{}' || true)"
# Prefer the dedicated access-key endpoint when available.
keyjson="$(api POST "/accounts/$account_id/r2/credentials" "{\"bucket\":\"$bucket\"}" || true)"
ACCESS_KEY_ID="$(printf '%s' "$keyjson"  | json_field "['result']['accessKeyId']")"
SECRET_ACCESS_KEY="$(printf '%s' "$keyjson" | json_field "['result']['secretAccessKey']")"
if [[ -z "$ACCESS_KEY_ID" || -z "$SECRET_ACCESS_KEY" ]]; then
  echo "Could not mint an S3 credential through the API." >&2
  echo "Create an R2 API token manually (R2 > Manage API Tokens > Create API token)," >&2
  echo "grant it Object Read & Write on '$bucket', then rerun with:" >&2
  echo "  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... bash scripts/setup-r2.sh" >&2
  exit 1
fi
echo "    credential minted"

echo "==> Pushing Worker secrets"
"$project_root/scripts/push-worker-secret.sh" S3_ENDPOINT "https://$account_id.r2.cloudflarestorage.com"
"$project_root/scripts/push-worker-secret.sh" S3_BUCKET "$bucket"
"$project_root/scripts/push-worker-secret.sh" S3_ACCESS_KEY_ID "$ACCESS_KEY_ID"
"$project_root/scripts/push-worker-secret.sh" S3_SECRET_ACCESS_KEY "$SECRET_ACCESS_KEY"
"$project_root/scripts/push-worker-secret.sh" S3_REGION "auto"

echo
echo "Done. Verify with:"
echo "  npx wrangler secret list --name $worker"
