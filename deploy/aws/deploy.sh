#!/usr/bin/env bash
# Ship the current working tree to the provisioned EC2 instance and bring the
# whole stack up with docker-compose. Re-runnable: subsequent runs redeploy the
# latest code.
#
#   ./deploy.sh
#
# Reads deploy/aws/.state (from provision.sh) and deploy/aws/.env.aws (secrets).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
[ -f "$HERE/.state" ] || { echo "✖ deploy/aws/.state missing — run provision.sh first."; exit 1; }
# shellcheck disable=SC1091
source "$HERE/.state"
[ -f "$HERE/.env.aws" ] || { echo "✖ deploy/aws/.env.aws missing — copy .env.aws.example and fill it."; exit 1; }

KEY="$KEY_PATH"
HOST="ubuntu@${PUBLIC_IP}"
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "$KEY")
SCP=(scp -o StrictHostKeyChecking=accept-new -i "$KEY")

# ── Wait for the instance bootstrap (docker install) to finish ────────────
echo "→ Waiting for instance bootstrap (docker install) …"
for i in $(seq 1 60); do
  if "${SSH[@]}" "$HOST" 'test -f /opt/stack62/.bootstrap-done && docker --version' >/dev/null 2>&1; then
    echo "✓ Instance ready"
    break
  fi
  [ "$i" = 60 ] && { echo "✖ Timed out waiting for bootstrap. Check /var/log/cloud-init-output.log on the box."; exit 1; }
  sleep 15
done

# ── Build a clean source bundle: tracked + untracked-not-ignored files only ─
# (Excludes node_modules / generated / storage / dist via .gitignore.) Uses
# Python's tarfile — Git Bash's `tar` hangs on Windows.
echo "→ Packaging source …"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PYTHONIOENCODING=utf-8 python "$HERE/make_bundle.py" "$TMP/bundle.tgz"

# ── Ship + extract + env ───────────────────────────────────────────────────
echo "→ Uploading …"
"${SCP[@]}" "$TMP/bundle.tgz" "$HOST:/opt/stack62/bundle.tgz"
"${SCP[@]}" "$HERE/.env.aws" "$HOST:/opt/stack62/.env"
"${SSH[@]}" "$HOST" 'cd /opt/stack62 && tar xzf bundle.tgz && rm -f bundle.tgz'

# ── Build + run the whole stack (backend + ollama + web/caddy) ────────────
echo "→ Building and starting containers (first run pulls models — a few minutes) …"
"${SSH[@]}" "$HOST" 'cd /opt/stack62 && sudo docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml up -d --build'

# ── Post-deploy health gate ────────────────────────────────────────────────
# A runtime-only boot error (e.g. a bad entity) compiles fine but crash-loops
# the API. Poll /v1/health on the box; if it doesn't come up, surface the API
# logs and FAIL loudly so the operator knows immediately (instead of finding a
# silent 502 later).
echo "→ Health check (waiting for API to report healthy) …"
HEALTHY=0
for i in $(seq 1 24); do
  if "${SSH[@]}" "$HOST" 'curl -fsS -m 5 http://localhost:3000/v1/health >/dev/null 2>&1'; then
    echo "✓ API healthy"
    HEALTHY=1
    break
  fi
  sleep 5
done
if [ "$HEALTHY" != "1" ]; then
  echo ""
  echo "✖ API did NOT become healthy after ~2 min. Last 40 log lines:"
  "${SSH[@]}" "$HOST" 'sudo docker logs stack62-api --tail 40 2>&1' || true
  echo ""
  echo "✖ Deploy finished but the API is unhealthy. Investigate or roll back."
  exit 1
fi

echo ""
echo "✓ Deployed."
echo "   App (frontend + API, one origin):  http://${PUBLIC_IP}"
echo "   API health:                        http://${PUBLIC_IP}:3000/v1/health"
echo "   SSH:                               ssh -i ${KEY} ${HOST}"
echo "   Logs:                              ssh -i ${KEY} ${HOST} 'cd /opt/stack62 && sudo docker compose logs -f api'"
echo ""
echo "   The local model builds on first boot; check it with:"
echo "     ssh -i ${KEY} ${HOST} 'sudo docker exec stack62-ollama ollama list'"
