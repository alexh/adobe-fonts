# Troubleshooting

## `Missing ADOBE_FONTS_API_TOKEN`

Set a token in your shell:

```bash
export ADOBE_FONTS_API_TOKEN="your-token"
```

Generate token from Adobe Fonts account token page.

## HTTP 401 or 403

- Verify token value.
- Confirm token has access to the account owning the kits.
- Re-run `afont doctor`.

## Kit not found

`--kit` accepts kit ID or exact kit name.

Try:

```bash
afont kits list
```

Then re-run with the exact ID.

## Search returns zero results

- Broaden `--query`.
- Try removing `--classification` or `--language` filters.
- Refresh local index:
  ```bash
  afont index refresh
  ```
- Validate token and API connectivity via `afont doctor`.

## Slow search

Use cache-first mode:

```bash
afont index refresh
afont search --query <term> --cache-only
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
  afont view --url https://fonts.adobe.com/fonts/droid-serif --timeout-ms 90000
  ```
- Increase post-load wait if previews are still loading:
  ```bash
  afont view --url https://fonts.adobe.com/fonts/droid-serif --wait-ms 3000
  ```
