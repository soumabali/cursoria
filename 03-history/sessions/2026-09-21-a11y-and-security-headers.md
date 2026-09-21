# Session - Accessibility fixes and security headers

Date: 2026-09-21
Project: Cursoria / "Cursor Studio"

Two real defects found and fixed, both verified against production.

## 1. WCAG contrast: 19 failing tones -> 0

Audited computed styles in the live browser. The `--muted` token
measured **4.22:1** on paper and **3.98:1** on tinted strips, below the
4.5:1 AA threshold, and 13 other hardcoded grays were worse
(3.09-4.22). Worst offenders: footer copy 3.09, stat-card small 3.12,
card meta 3.12-3.56.

Fix: darkened the muted family, choosing each value so it clears 4.5:1
against the **darkest** surface it actually sits on (#ecefe4 dashboard
nav), which makes it safe on every lighter surface too. Measured with
a script, not by eye, and the sage/olive palette and its hue
relationships are preserved:

  --muted    #75796f -> #5d6656   (4.22 -> 5.15 worst case)
  hero copy  #71766c -> #5d6656
  results    #7a8172 -> #5c6653
  card meta  #7e8774/#8a9083/#8d9486 -> #5f6a55
  footer     #8a9182 -> #636d58
  breadcrumb #7c8571 -> #636d58
  th         #7e8973 -> #5f6b55
  link/em    #688344/#69864d -> #4e6b37
  badge pend #8b6f26 -> #7a5f18 on its own chip bg (4.09 -> 5.17)

Decorative art fills and borders were deliberately left alone: they
carry no text, so the text-contrast rule does not apply (the art
backgrounds and `.art-*` borders, `.secondary` border, sparkle glyph
colors).

## 2. Heading order

`/dashboard` went H1 -> H3 because the empty states used `<h3>`
directly after the page `<h1>`. Now `<h2>`, and the
`.empty-state h3` CSS rule extended to cover `h2`. Heading sequences
are now 1,2 (dashboard), 1,2,2 (product), 1,2,3,2,3,3,3,2 (home) with
no skips and exactly one H1 per page.

## 3. Decorative glyphs

The sparkles and dock icons (✦ ✧ ✳ ✿ ♡ ↗) are `aria-hidden="true"`
now, so assistive tech skips them instead of announcing bare symbols.
That also removes them from contrast accounting, which is correct:
they are ornament, not content.

## 4. Security headers were never actually sent

`next.config.ts` declared a CSP, X-Content-Type-Options,
Referrer-Policy, X-Frame-Options and Permissions-Policy. The vinext
bundle even contained the strings. But **none appeared on live
responses** - the deployed Worker runs the vinext build, which does not
apply Next.js `headers()`.

So the README's claim of a configured CSP was describing intent, not
production. Set the headers in `worker/index.ts` instead, merging them
under any header the app already sets (so `/api/*` keeps the nosniff it
sets itself).

Verified live after deploy: all five present on `/`, product pages,
`/signin` and API routes; **zero CSP violations** in the browser; body
styles, images and client interactivity (category filter toggling
1 pack -> Nature -> 0 packs) all still work.

`script-src`/`style-src` still allow `'unsafe-inline'`: React streams
inline bootstrap code, so a nonce must be threaded through render.
That remains an open follow-up rather than something to fake.

## Verification gates (all green before each deploy)

eslint 0 errors; tsc clean; security tests 12/12; vinext build complete.

## Deploys

1bb7b8a5  contrast + heading order
98bca584  decorative glyphs aria-hidden
fa60a51d  security headers in the Worker

## Commits

cc6a8d5  fix: security headers never reached production
63a54fa  a11y: fix WCAG contrast, heading order, and decorative glyphs
