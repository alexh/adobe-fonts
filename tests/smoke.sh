#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AFONT="$ROOT_DIR/scripts/afont"

$AFONT --help >/tmp/afont-help.txt
env -u ADOBE_FONTS_API_TOKEN "$AFONT" kits list --json >/tmp/afont-kits.json 2>/tmp/afont-kits.err || true
$AFONT doctor --json >/tmp/afont-doctor.json 2>/tmp/afont-doctor.err || true
env -u ADOBE_FONTS_API_TOKEN "$AFONT" view --url https://fonts.adobe.com/fonts/droid-serif --dry-run --json >/tmp/afont-view.json 2>/tmp/afont-view.err || true
$AFONT view --url https://example.com --dry-run --json >/tmp/afont-view-bad.json 2>/tmp/afont-view-bad.err || true

if ! grep -q 'afont view --family' /tmp/afont-help.txt; then
  echo "Expected view command in --help output"
  exit 1
fi

if ! grep -q 'Missing ADOBE_FONTS_API_TOKEN' /tmp/afont-kits.err; then
  echo "Expected missing-token error for kits list when token is unset"
  exit 1
fi

if ! grep -q 'tokenPresent' /tmp/afont-doctor.json; then
  echo "Expected doctor output schema in JSON"
  exit 1
fi

if ! grep -q '"intent": "view"' /tmp/afont-view.json; then
  echo "Expected view output schema in JSON"
  exit 1
fi

if ! grep -q 'View URL must be hosted on fonts.adobe.com or typekit.com' /tmp/afont-view-bad.err; then
  echo "Expected domain validation error for view command"
  exit 1
fi

echo "Smoke tests passed"
