# guneykayim.com — personal site

Source for Güney Kayım's personal site, served at https://guneykayim.com
(and mirrored by GitHub Pages at https://guneykayim.github.io).

Plain static HTML/CSS/JS in a single `index.html` — no build step.

## Review variants (October 2026)

Three complete designs live in the same page, selected by URL hash:

- `/#vA` — A · Minimal: hero, about, links only
- `/#vB` — B · Showcase: profile + project cards + research + interests
- `/#vC` — C · Notes: editorial layout with a planned Notes/blog section

A small floating “Review” bar at the bottom switches between them.
Once a variant is chosen, the other two and the review bar will be removed.

## Hosting

Production is a Cloudflare Pages project (`guneykayim`) with the custom
domain `guneykayim.com`, matching the other `*.guneykayim.com` sites.
This repo is the source of truth; GitHub Pages also serves the same files
at guneykayim.github.io, which is a useful instant preview after a push.
