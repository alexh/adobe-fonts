# Adobe Fonts Workflow Summary

## Context
- Brand: Northline Wealth Advisory
- Audience: High-net-worth professionals (35-60)
- Voice: Trustworthy, modern, editorial
- Goal: Marketing-site typography refresh for credibility + readability
- Domain: `example.com`
- Kit name: `marketing-site`

## What Was Run
1. `doctor` and `index status` to validate auth/cache.
2. Cache-backed discovery searches for serif/sans candidates.
3. Kit workflow:
   - `kits ensure` dry-run, then create
   - `kits add-family` dry-run for each family
   - `kits publish` dry-run
   - apply adds + publish
   - `kits embed`
4. Verified generated CSS at `https://use.typekit.net/xxxxxxx.css` to confirm exact family names.

## Final Selection
- Headlines: `adobe-caslon-pro`
  - Why: classic editorial authority, premium tone, avoids decorative quirks.
  - Added weights/styles: 400, 600, 700 (normal + italic)
- Body/UI text: `acumin-pro`
  - Why: clean modern sans with excellent screen readability and strong production range.
  - Added weights/styles: 300, 400, 500, 600, 700 (normal + italic)

## Kit Result
- Kit ID: `xxxxxxx`
- Kit name: `marketing-site`
- Domains: `example.com`, `www.example.com`
- Embed URL: `https://use.typekit.net/xxxxxxx.css`

## Integration Snippets
```html
<link rel="stylesheet" href="https://use.typekit.net/xxxxxxx.css">
```

```css
:root {
  --font-heading: "adobe-caslon-pro-1", serif;
  --font-body: "acumin-pro-1", sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  font-weight: 600;
  letter-spacing: -0.01em;
}

body {
  font-family: var(--font-body);
  font-weight: 400;
  line-height: 1.6;
}
```

## Notes
- `kits embed` returned aliases with `-1` suffix; these were validated directly from published CSS.
- No API warnings were reported in command results.
