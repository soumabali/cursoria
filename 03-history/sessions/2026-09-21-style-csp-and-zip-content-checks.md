# Session — style-src hardening, ZIP content checks, delegations

Date: 2026-09-21
Project: Cursoria / "Cursor Studio"

## 1. `style-src` no longer allows `unsafe-inline` (done)

`script-src` had already dropped it. `style-src` now is `'self'` too.

**The important discovery: `style-src` without `unsafe-inline` blocks inline
style ATTRIBUTES (`style-src-attr`), not just `<style>` elements.** An element
with `style="height:125px"` keeps that attribute in the DOM, but the
declaration is silently discarded and the element falls back to CSS. I had
previously written a comment claiming inline attributes were unaffected —
that was wrong, and it is corrected in `worker/index.ts`.

Proof (run against production): creating an element and setting the style via
`setAttribute` yields `element.style.cssText === ''` and computed height `0px`,
while setting the same value via the `.style` property yields `125px`. The
`securitypolicyviolation` event fires with `violatedDirective: 'style-src-attr'`.

A nonce can authorise a `<style>` element but **never** a style attribute, so
there is no CSP-side fix — the style has to come from the stylesheet.

### What changed

- All inline `style=` in shipped code migrated to utility classes in
  `globals.css` (`text-sm-title`, `text-sm-note`, `mt-14/15/18`, etc.).
- The revenue chart's bar height is data-driven and cannot be a static class.
  The server now picks a generated class: `.chart-bars>.bar-N` for N = 1..129.
  Verified live: `bar-125` → computed `125px`, other days `2px`.
- The 61 unused shadcn primitives moved from `components/ui` to
  `00-vendor/shadcn-unused/`. Nothing in the app imported them; three carried
  inline styles and none ships. Verified zero vendored symbols in `dist/`, and
  lint now ignores the vendor directory.

### Three of my own wrong turns, recorded

1. I assumed the CSP was fine because `getAttribute('style')` showed a value.
   `getAttribute` returns the raw attribute; it says nothing about whether the
   declaration applies. **Read `element.style.cssText` or the computed value.**
2. I spent several rounds blaming CSS specificity, `min-height`, `@property`
   registration and flex behaviour. All wrong. The violation event named the
   actual cause in one call. **When a CSP is in play, check for a violation
   before theorising about the cascade.**
3. React renders a bare number as a unitless declaration: `{height: 125}`
   emits `height:125`, which the browser discards. It needs a unit string.

## 2. ZIP uploads: content inspection (done)

The validator checked archive structure and entry *names* only. An allowed
extension said nothing about the bytes: a `.png` that was actually HTML, or
script inside `readme.txt`, passed. A pack is a file a buyer downloads and
opens, so that is a delivery vehicle.

`inspectZipContents` now decompresses each member (bounded to 12 MB) and reads
its real type from the leading bytes: PNG members must be PNG/JPEG/WebP/BMP,
text must be text without markup/script and without NUL bytes, and `.cur`/`.ani`
must carry their correct magic. It is explicit in the code that this is not
antivirus.

Built a 13-case adversarial suite; all 13 behave correctly. Five are now
permanent tests, so security tests went 12 → 17.

**A real bug in my own first attempt:** I read the local header's name/extra
lengths at the *central directory's* offsets, so the payload offset landed
mid-stream and inflate failed on every valid entry. The suite caught it only
because it included packs that must PASS as well as packs that must FAIL —
a suite of only negative cases would have "passed" while rejecting all real
uploads.

Verified on production: a ZIP carrying HTML in `preview.png` → 400
"A preview PNG is not actually an image."; a genuine pack → 200.

## 3. Independent review (delegated)

Both remaining open items were reviews of my own work, which I cannot do
honestly by myself, so they were delegated to two fresh-context reviewers:
one security review of the whole surface, one product/operations review whose
main job is checking that the published policies match real behaviour.
Read-only, no deploys, no writes to production.

## Verification

- Gate every deploy: tsc clean, eslint 0, security tests 17/17, build OK.
- `style-src 'self'` and `script-src` nonce live; 0 CSP violations across
  11 routes; all routes styled and rendering.
- Production DB back to one row (the superadmin), empty catalog, empty R2.
