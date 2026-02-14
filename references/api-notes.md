# Adobe Fonts API Notes

This skill targets the legacy Typekit API used by Adobe Fonts:

- Base URL default: `https://typekit.com/api/v1/json`
- Authentication header: `X-Typekit-Token: <token>`

## Endpoints Used

- `GET /kits`
- `POST /kits`
- `GET /kits/:kit`
- `POST /kits/:kit`
- `POST /kits/:kit/families/:family`
- `POST /kits/:kit/publish`
- `GET /kits/:kit/published`
- `GET /libraries`
- `GET /libraries/:library`

## Visual Preview Notes (`afont view`)

- `afont view` captures Adobe-hosted preview pages with Playwright.
- For `--family` resolution, the command first tries `GET /families/:family` and falls back to internal search + re-resolve.
- For `--url`, no token is required but URL host must be `fonts.adobe.com` or `typekit.com`.

## Search Behavior

The API is not a direct full-text search endpoint.

`afont search` uses a cache-first strategy:

- Local SQLite index (`~/.cache/afont/fonts.sqlite3`) with FTS (`name`, `slug`, `description`, `classification`, `foundry`)
- Optional refresh via `afont index refresh` or `afont search --refresh-cache`
- API fallback when cache misses and `--cache-only` is not set

Index refresh tracks page-level hashes from `libraries/:library?page=:n&per_page=:n` and only re-fetches changed/new family details from `families/:family`.

## Compatibility Caveats

- Adobe may change response shape for legacy endpoints.
- Large font libraries can increase search latency.
- `--dry-run` avoids mutating API calls but still resolves existing kits.
