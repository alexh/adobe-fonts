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

Optional:

```bash
export ADOBE_FONTS_DEFAULT_KIT="my-kit"
export ADOBE_FONTS_DEFAULT_DOMAINS="example.com,www.example.com"
export AFONT_API_BASE="https://typekit.com/api/v1/json"
export AFONT_CACHE_MAX_AGE_HOURS="168"
export AFONT_CACHE_DIR="/custom/path/for/afont-cache"
```

Cache location default:

- `<skill-install-dir>/.cache/fonts.sqlite3`
- Example: `~/.codex/skills/adobe-fonts/.cache/fonts.sqlite3`
- Example: `~/.claude/skills/adobe-fonts/.cache/fonts.sqlite3`

## CLI Quick Start

```bash
# Health check
scripts/afont doctor

# Build or refresh local SQLite + FTS index (recommended first run)
scripts/afont index refresh

# View cache/index status
scripts/afont index status

# Search families (uses local cache first, API fallback if needed)
scripts/afont search --query legitima --limit 5

# Force cache refresh before search
scripts/afont search --query editorial --refresh-cache

# Search cache only (no API calls)
scripts/afont search --query round --cache-only

# Capture Adobe family preview screenshot (Codex-consumable output)
scripts/afont view --url https://fonts.adobe.com/fonts/droid-serif --json

# Resolve by family slug/name and capture
scripts/afont view --family droid-serif --json

# List kits
scripts/afont kits list

# Ensure a kit exists
scripts/afont kits ensure --name marketing-site --domains example.com,www.example.com

# Add family to a kit
scripts/afont kits add-family --kit marketing-site --family legitima

# Publish and show embed snippets
scripts/afont kits publish --kit marketing-site
scripts/afont kits embed --kit marketing-site
```

## Output Contract

The CLI supports `--json` and emits a stable shape documented in:

- `references/output-schema.md`

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
- Cache files are stored inside the skill directory by default (not in a global random location).
- Mutating kit commands support `--dry-run`.
- This skill does not patch framework files deterministically. It returns metadata/snippets for the calling agent to apply.
- `afont view` requires Playwright. If Chromium binaries are missing, run `npx playwright install chromium`.

## License

MIT
