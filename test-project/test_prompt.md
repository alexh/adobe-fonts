Use the adobe-fonts skill end-to-end for a realistic web workflow.

Business context:
- Brand: **Northline Wealth Advisory** (independent financial planning firm).
- Audience: high-net-worth professionals, ages 35-60.
- Brand voice: trustworthy, modern, editorial.
- Goal: redesign marketing site typography for credibility + readability.
- Site domain: example.com.
- Kit name: marketing-site.

Design direction:
- Headlines: editorial serif with authority (premium, not decorative).
- Body: clean sans with excellent web readability.
- Avoid overly quirky/display faces.
- Prioritize families with broad weight/style support for production use.

Please do this in order:
1. Run afont doctor and report auth/setup issues clearly.
2. Search for at least:
   - 6 serif candidates for headlines
   - 4 sans candidates for body
   Return them as separate lists with 1-2 sentence rationale each.
3. Pick your top 2 typography pairings (headline serif + body sans) and explain tradeoffs.
4. Ensure the kit exists (marketing-site for example.com).
5. Add the selected families to the kit.
6. Publish the kit.
7. Return final integration output in this exact format:
   - Link tag
   - CSS variables block (--font-heading, --font-body)
   - Example usage CSS for h1,h2,h3 and body
8. Also return raw JSON outputs for each CLI step in collapsible sections.

Constraints:
- Use dry-run first for mutating steps, then run real commands.
- If any API call fails, show:
  - failing command
  - exact error
  - best fallback
- Do not ask me to open Adobe Fonts UI.
If you want, I can also give you 2 more versions tuned for ecommerce and SaaS.

