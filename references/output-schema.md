# afont Output Schema

All commands support `--json` and output:

```json
{
  "result": {
    "intent": "search | view | kit_update | embed | doctor | kit_list | index_refresh | index_status",
    "fonts": [
      {
        "familyName": "Legitima",
        "slug": "legitima",
        "cssFamily": "legitima",
        "description": "Editorial serif description...",
        "webLink": "https://fonts.adobe.com/fonts/legitima",
        "classification": "serif",
        "foundry": "Adobe",
        "weights": ["400", "700"],
        "styles": ["normal", "italic"]
      }
    ],
    "kit": {
      "id": "nac7upn",
      "name": "marketing-site",
      "domains": ["example.com"],
      "embedUrl": "https://use.typekit.net/nac7upn.css",
      "htmlLinkTag": "<link rel=\"stylesheet\" href=\"https://use.typekit.net/nac7upn.css\">"
    },
    "snippets": {
      "htmlLinkTag": "<link rel=\"stylesheet\" href=\"https://use.typekit.net/nac7upn.css\">",
      "cssExamples": ["font-family: legitima, serif;"]
    },
    "warnings": ["warning text"],
    "nextActions": ["next step"],
    "cache": {
      "dbPath": "/Users/you/.codex/skills/adobe-fonts/.cache/fonts.sqlite3",
      "lastRefreshAt": "2026-02-14T00:00:00.000Z",
      "stale": false
    },
    "view": {
      "familyRef": "droid-serif",
      "resolvedFamilySlug": "droid-serif",
      "pageUrl": "https://fonts.adobe.com/fonts/droid-serif",
      "source": "adobe_page",
      "outputDir": "/Users/you/.codex/skills/adobe-fonts/.cache/views",
      "screenshotPath": "/Users/you/.codex/skills/adobe-fonts/.cache/views/droid-serif-2026-02-14T00-00-00-000Z.png",
      "screenshotBytes": 123456,
      "sha256": "3b2b9f0f2b1f...",
      "viewport": {
        "width": 1440,
        "height": 2200
      },
      "fullPage": true
    },
    "codex": {
      "imagePath": "/Users/you/.codex/skills/adobe-fonts/.cache/views/droid-serif-2026-02-14T00-00-00-000Z.png",
      "markdownImage": "![afont-preview](/Users/you/.codex/skills/adobe-fonts/.cache/views/droid-serif-2026-02-14T00-00-00-000Z.png)"
    },
    "dryRun": true,
    "action": "create | update | add-family | publish"
  },
  "meta": {
    "source": "adobe_api",
    "timestamp": "2026-02-14T00:00:00.000Z"
  }
}
```

## Contract Rules

- `result.intent` is always present.
- `result.warnings` and `result.nextActions` are always arrays when present.
- `search` may include `result.cache` metadata when local SQLite cache is used.
- `view` includes `result.view` and `result.codex` for screenshot handoff.
- Mutating commands add `result.dryRun` and `result.action`.
- `meta.source` is always `adobe_api`.
