# guneykayim.com — personal site

Source for Güney Kayım's personal site, served at https://guneykayim.com
(and mirrored by GitHub Pages at https://guneykayim.github.io).

Plain static HTML/CSS in a single `index.html` — no build step. The only
JavaScript calculates the years of experience dynamically
(current year − 2009, displayed as `~<years> years`).

The page has a hero header with a small WhatsApp logo, an About section,
project cards (Blackjack, Year 2 Maths Games, Mindmap), interests,
a “Find me” link list (GitHub, Bluesky, Threads, and Turkish writing on
Substack), and a Consultation section linking to Zcal for paid calls.

## Hosting

Production is a Cloudflare Pages project (`guneykayim`) with the custom
domain `guneykayim.com`, matching the other `*.guneykayim.com` sites.
This repo is the source of truth; GitHub Pages also serves the same files
at guneykayim.github.io, which is a useful instant preview after a push.
