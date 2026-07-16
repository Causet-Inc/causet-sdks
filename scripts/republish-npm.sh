#!/usr/bin/env bash
# Unpublish and republish all @causet/* npm packages at the version in package.json.
#
# Requires: npm login to an account with publish + unpublish on @causet
# Usage:
#   npm login
#   ./scripts/republish-npm.sh              # prompts for 2FA OTP if needed
#   NPM_CONFIG_OTP=123456 ./scripts/republish-npm.sh
#
# npm may block republishing for 24 hours after removing the only version of a package.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf '%b\n' "${GREEN}==>${NC} $*"; }
warn() { printf '%b\n' "${YELLOW}==>${NC} $*"; }
die()  { printf '%b\n' "${RED}error:${NC} $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd npm
require_cmd node

if ! npm whoami >/dev/null 2>&1; then
  die "not logged in to npm — run: npm login"
fi

log "Logged in as $(npm whoami)"

VERSION="$(node -p "require('./packages/core/package.json').version")"
log "Target version: ${VERSION}"

if [[ -z "${NPM_CONFIG_OTP:-}" ]]; then
  read -r -p "npm 2FA one-time password (leave blank if not required): " OTP_INPUT || true
  if [[ -n "${OTP_INPUT:-}" ]]; then
    export NPM_CONFIG_OTP="$OTP_INPUT"
  fi
fi

UNPUBLISH_ORDER=(
  @causet/sdk-next
  @causet/sdk-node
  @causet/sdk
  @causet/sdk-core
)

PUBLISH_ORDER=(
  @causet/sdk-core
  @causet/sdk
  @causet/sdk-node
  @causet/sdk-next
)

log "Building and testing..."
npm ci
npm run build
npm test
npm audit --audit-level=high

warn "Unpublishing ${VERSION} from npm (dependents first)..."
for pkg in "${UNPUBLISH_ORDER[@]}"; do
  log "Unpublishing ${pkg}@${VERSION}..."
  if npm unpublish "${pkg}@${VERSION}" --force; then
    log "Removed ${pkg}@${VERSION}"
  else
    warn "Skip or failed: ${pkg}@${VERSION} (may already be unpublished)"
  fi
done

warn "Waiting 30s for npm registry propagation..."
sleep 30

log "Publishing ${VERSION} to npm..."
for pkg in "${PUBLISH_ORDER[@]}"; do
  log "Publishing ${pkg}@${VERSION}..."
  npm publish -w "${pkg}" --access public
done

log "Done. Verify:"
for pkg in "${PUBLISH_ORDER[@]}"; do
  echo "  npm view ${pkg} version dist-tags"
  npm view "${pkg}" version dist-tags
done
