# guneykayim.com — personal site

Source for Güney Kayım's personal site, served at https://guneykayim.com
(and mirrored by GitHub Pages at https://guneykayim.github.io).

Plain static HTML/CSS in a single `index.html` — no build step. The only
JavaScript calculates the years of experience dynamically and displays
it in the `~<years> years` format.

The page has a hero header with a small WhatsApp logo, an About section,
project cards (Blackjack and Year 2 Maths Games), a “Find me” section
with icon tiles for GitHub, Bluesky, Threads and Substack (writing in
Turkish), and a Consultation section linking to Zcal for paid calls.
All brand icons are inline SVGs (Simple Icons paths) — no external assets.

## Hosting

Production is a Cloudflare Pages project (`guneykayim`) with the custom
domain `guneykayim.com`, matching the other `*.guneykayim.com` sites.
This repo is the source of truth; GitHub Pages also serves the same files
at guneykayim.github.io, which is a useful instant preview after a push.
