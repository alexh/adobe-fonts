---
name: adobe-fonts
description: Search Adobe Fonts (Typekit) families, create and manage web kits/projects, and return ready-to-use embed snippets plus CSS font-family values. Use when the user asks to find Adobe fonts, compare font options, set up Typekit for a website, add fonts to kits, publish kits, or generate copy/paste font embed metadata for Codex, Claude Code, or OpenCode workflows.
---

# Adobe Fonts

Use this skill to handle Adobe Fonts/Typekit workflow without opening the Adobe Fonts UI.

## Prerequisites

1. Ensure `ADOBE_FONTS_API_TOKEN` is set.
2. Run `scripts/afont doctor` before mutating actions.
3. Build local index once: `scripts/afont index refresh`

## Commands

Run via:

```bash
scripts/afont <command>
```

Supported commands:

- `index refresh`
- `index status`
- `search`
- `view`
- `kits list`
- `kits ensure`
- `kits add-family`
- `kits publish`
- `kits embed`
- `doctor`

## Default Workflow

1. Discover candidates:
   - `afont search --query <keyword> --limit 8` (cache-first)
2. Ensure target kit exists:
   - `afont kits ensure --name <kit-name> --domains <d1,d2>`
3. Add family:
   - `afont kits add-family --kit <kit-name-or-id> --family <family-slug>`
4. Publish:
   - `afont kits publish --kit <kit-name-or-id>`
5. Return integration snippets:
   - `afont kits embed --kit <kit-name-or-id>`

Visual preview workflow:

- Capture Adobe preview page screenshot for Codex analysis:
  - `afont view --family <family-slug> --json`
  - or `afont view --url https://fonts.adobe.com/fonts/<family-slug> --json`

## Confirmation Gate For Long Runs

Before running potentially long index operations, ask for user confirmation.

Treat these as long-running and confirm first:

- `afont index refresh` with default/full settings
- `afont index refresh --max-pages > 5`
- `afont search --refresh-cache` when cache is missing or stale

When asking, offer two options:

- Quick refresh: smaller scope (example: `--max-pages 3`)
- Full refresh: complete indexing (example: `--per-page 500 --max-pages 40`)

## Output Expectations

Always return:

- Link tag snippet: `<link rel="stylesheet" href="https://use.typekit.net/<kit>.css">`
- CSS family examples, such as `font-family: legitima, serif;`
- Any API warnings from `result.warnings`

Use `--json` for machine parsing when chaining steps.

Search cache flags:

- `--refresh-cache` to refresh index before search
- `--cache-only` to avoid network calls
- `--no-cache` to force API path

## Safety

- Prefer `--dry-run` first for mutating commands.
- Do not modify app source files unless the user explicitly asks to apply snippets.

## Resources

- `references/output-schema.md`
- `references/api-notes.md`
- `references/troubleshooting.md`
