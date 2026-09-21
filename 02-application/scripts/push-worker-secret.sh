#!/usr/bin/env bash
# Push a single secret value onto the Cursoria Worker without leaking it
# into argv (wrangler would show it in the process table).
#
#   printf '%s' "$VALUE" | scripts/push-worker-secret.sh NAME
#   scripts/push-worker-secret.sh NAME "$VALUE"
set -euo pipefail

name="${1:?usage: push-worker-secret.sh NAME [VALUE]}"
worker="${CURSORIA_WORKER:-cursoria}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ge 2 ]]; then
  value="$2"
else
  value="$(cat)"
fi

if [[ -z "$value" ]]; then
  echo "refusing to push an empty value for $name" >&2
  exit 64
fi

cd "$project_root"
printf '%s' "$value" | npx wrangler secret put "$name" --name "$worker"
