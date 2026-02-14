# adobe-fonts

Adobe Fonts (Typekit) skill for Codex, Claude Code, and OpenCode.

This repository is a single-skill package for the open Skills CLI ecosystem.

## Install

Use this repository path:

```bash
# Install this skill
npx skills add alexh/adobe-fonts

# Install globally for specific agents
npx skills add alexh/adobe-fonts -a codex -a claude-code -a opencode -g -y
```

## Requirements

- Node.js 18+
- Adobe Fonts API token

Set token in your shell:

```bash
export ADOBE_FONTS_API_TOKEN="your-token"
```

Get/create token: `https://fonts.adobe.com/account/tokens`

Optional:

```bash
export ADOBE_FONTS_DEFAULT_KIT="my-kit"
export ADOBE_FONTS_DEFAULT_DOMAINS="example.com,www.example.com"
export AFONT_API_BASE="https://typekit.com/api/v1/json"
export AFONT_CACHE_MAX_AGE_HOURS="168"
export AFONT_HTTP_TIMEOUT_MS="25000"
export AFONT_HTTP_MAX_RETRIES="2"
export AFONT_HTTP_RETRY_BASE_MS="500"
export AFONT_CACHE_DIR="/custom/path/for/afont-cache"
```

Cache location default:

- `<skill-install-dir>/.cache/fonts.sqlite3`
- Example: `~/.codex/skills/adobe-fonts/.cache/fonts.sqlite3`
- Example: `~/.claude/skills/adobe-fonts/.cache/fonts.sqlite3`

Path behavior note:

- If you run `scripts/afont` from this repository checkout, cache will be under this repo (`<repo>/.cache/fonts.sqlite3`).
- If you run the installed binary (`$HOME/.agents/skills/adobe-fonts/scripts/afont`), cache will be under the installed skill directory.

## CLI Quick Start

Resolve the installed skill CLI path first (recommended when running from another project directory):

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
  echo "afont CLI not found. Reinstall skill: npx skills add alexh/adobe-fonts -g -y" >&2
  return 1 2>/dev/null || exit 1
fi
```

```bash
# Health check
"$AFONT_BIN" doctor

# One-time warmup after install (recommended for fast searches)
"$AFONT_BIN" index refresh

# View cache/index status
"$AFONT_BIN" index status

# View cache stats (counts + top classifications/foundries)
"$AFONT_BIN" index stats --limit 8

# Search families (uses local cache first, API fallback if needed)
"$AFONT_BIN" search --query legitima --limit 5

# Force cache refresh before search
"$AFONT_BIN" search --query editorial --refresh-cache

# Search cache only (no API calls)
"$AFONT_BIN" search --query round --cache-only

# Capture Adobe family preview screenshot
"$AFONT_BIN" view --url https://fonts.adobe.com/fonts/droid-serif --json

# Resolve by family slug/name and capture
"$AFONT_BIN" view --family droid-serif --json

# List kits
"$AFONT_BIN" kits list

# Ensure a kit exists
"$AFONT_BIN" kits ensure --name marketing-site --domains example.com,www.example.com

# Add family to a kit
"$AFONT_BIN" kits add-family --kit marketing-site --family legitima

# Publish and show embed snippets
"$AFONT_BIN" kits publish --kit marketing-site
"$AFONT_BIN" kits embed --kit marketing-site
```

## Output Contract

The CLI supports `--json` and emits a stable shape documented in:

- `references/output-schema.md`

## Reference Docs

- Output schema: [references/output-schema.md](references/output-schema.md)
- API/cache notes: [references/api-notes.md](references/api-notes.md)
- Troubleshooting: [references/troubleshooting.md](references/troubleshooting.md)
- Example final summary: [references/example-summary.md](references/example-summary.md)

## Recommended Artifact Workflow

Prefer saving run artifacts to the current project instead of pasting large JSON in chat.

```bash
RUN_DIR="./adobe-fonts/runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"

"$AFONT_BIN" doctor --json > "$RUN_DIR/00_doctor.json"
"$AFONT_BIN" index status --json > "$RUN_DIR/00_index_status.json"
"$AFONT_BIN" index stats --json > "$RUN_DIR/00_index_stats.json"
"$AFONT_BIN" search --query "editorial serif" --classification serif --limit 8 --cache-only --json > "$RUN_DIR/10_search_editorial_serif.json"
```

Then write a short markdown summary at:

- `./adobe-fonts/runs/<timestamp>/summary.md`

## Testing

```bash
# Full suite: unit + smoke
npm test

# Unit/integration suite for afont.js only
npm run test:unit

# Optional real-browser screenshot e2e test
AFONT_RUN_VIEW_E2E=1 npm run test:unit
```

## Notes

- Adobe Fonts API is legacy Typekit API and may evolve.
- There is no first-party full-text search endpoint in the legacy API.
- This skill keeps a local SQLite cache with FTS so repeated searches are fast and description-aware.
- On first install (no cache yet), search warns that uncached lookups may be slow and recommends:
  - `afont index refresh --per-page 500 --max-pages 40`
- Cache files are stored inside the skill directory by default (not in a global random location).
- Mutating kit commands support `--dry-run`.
- This skill does not patch framework files deterministically. It returns metadata/snippets for the calling agent to apply.
- `afont view` requires Playwright. If Chromium binaries are missing, run `npx playwright install chromium`.

## License

MIT
