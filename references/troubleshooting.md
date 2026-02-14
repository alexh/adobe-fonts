# Troubleshooting

## `scripts/afont: no such file or directory`

This usually means you ran the command from your app repository, not from the installed skill directory.

Set an absolute binary path first, then reuse it:

```bash
if [ -z "${AFONT_BIN:-}" ]; then
  for p in \
    "$HOME/.agents/skills/adobe-fonts/scripts/afont" \
    "$HOME/.codex/skills/adobe-fonts/scripts/afont" \
    "$HOME/.claude/skills/adobe-fonts/scripts/afont" \
    "$HOME/.opencode/skills/adobe-fonts/scripts/afont"
  do
    if [ -x "$p" ]; then
      export AFONT_BIN="$p"
      break
    fi
  done
fi

if [ -z "${AFONT_BIN:-}" ] || [ ! -x "$AFONT_BIN" ]; then
  echo "afont CLI not found. Reinstall skill: npx skills add alexh/adobe-fonts -a codex -g -y" >&2
  return 1 2>/dev/null || exit 1
fi

"$AFONT_BIN" doctor
```

## `Missing ADOBE_FONTS_API_TOKEN`

Set a token in your shell:

```bash
export ADOBE_FONTS_API_TOKEN="your-token"
```

Generate token from: `https://fonts.adobe.com/account/tokens`

## HTTP 401 or 403

- Verify token value.
- Confirm token has access to the account owning the kits.
- Re-run `"$AFONT_BIN" doctor`.

## Kit not found

`--kit` accepts kit ID or exact kit name.

Try:

```bash
"$AFONT_BIN" kits list
```

Then re-run with the exact ID.

## Search returns zero results

- Broaden `--query`.
- Try removing `--classification` or `--language` filters.
- Refresh local index:
  ```bash
  "$AFONT_BIN" index refresh
  ```
- Validate token and API connectivity via `"$AFONT_BIN" doctor`.

## Slow search

Use cache-first mode:

```bash
"$AFONT_BIN" index refresh --per-page 500 --max-pages 40
"$AFONT_BIN" search --query <term> --cache-only
```

Use `--refresh-cache` only when needed.

## `afont view` says Playwright is not installed

Install dependencies in this repository:

```bash
npm install
```

## `afont view` says Chromium is missing

Install Chromium for Playwright:

```bash
npx playwright install chromium
```

## `afont view` timeout

- Retry the command.
- Increase timeout:
  ```bash
  "$AFONT_BIN" view --url https://fonts.adobe.com/fonts/droid-serif --timeout-ms 90000
  ```
- Increase post-load wait if previews are still loading:
  ```bash
  "$AFONT_BIN" view --url https://fonts.adobe.com/fonts/droid-serif --wait-ms 3000
  ```
