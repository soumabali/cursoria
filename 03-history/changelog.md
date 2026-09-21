# Changelog

## [Unreleased]

### Added
- Account deletion from My Library, with a `deleted_identities` table
  (sha256 of the deleted address) so a deleted account cannot be
  recreated by signing in again.
- `.gitignore` (the repo had none) and git remote `soumabali/cursoria`,
  pushed over SSH. The fine-grained token is read-only for git even
  though the API reports push permission.
- ZIP content inspection on upload: members are decompressed and their
  real type is read from the leading bytes, so HTML inside a `.png` or
  script inside a `readme.txt` is refused. Security tests 12 → 17.
- Resend outbound email wired up: Worker secrets EMAIL_API_KEY, EMAIL_FROM, SUPERADMIN_EMAIL set.
- Object storage live: Cloudflare R2 bucket `cursoria-packs` with the
  five S3_* Worker secrets set. Preview and package uploads, published
  previews, and entitlement-gated ZIP downloads all verified against
  production end to end.

### Changed
- Policies page rewritten with a per-data-type retention table, an
  account-deletion section that matches the implemented behaviour, a
  refund procedure, and a security section. The operator must still
  supply the legal business name, a monitored support mailbox
  (`CONTACT_EMAIL` placeholder), and the governing law.
- Open-tasks audit recorded; state verified against live prod (0 products, 0 payment_settings, no S3_* secrets).

### Fixed
- **ZIP bomb: a 0.25 MB upload hung the Worker past 60 s and left the site
  intermittently unresponsive.** Declared-size limits were satisfied by the
  archive lying about its own contents. The member's declared size is now
  checked before decompressing, so the allocation is bounded by the cap
  rather than by the archive. Refused in 0.12–0.25 s.
- `.txt` markup check was a tag blocklist; it is now an allowlist (any `<`
  is refused).
- `objectRequest` had no key guard: `..` collapses under URL normalisation
  and drops the bucket prefix, so the per-user prefix was not a boundary.
- No per-IP limit on `auth/request` (mail-bomb plus shared-bucket DoS), and
  a deleted address was distinguishable from any other. Both fixed; the
  refusal now answers identically to a normal request.
- `views` was unlimited and trusted a shape-checked cookie, so view counts
  were inflatable. Now rate-limited per IP.
- The inline Snap call in `checkout` had drifted from `openCheckout` (no
  timeout, different item details); both share one function now.
- Every outbound fetch now has a timeout. None did, so a hung dependency
  produced a raw 5xx instead of the considered error each path already had.
- `style-src` no longer allows 'unsafe-inline'. Inline style ATTRIBUTES
  are blocked by `style-src-attr`, so every element-level `style=` was
  migrated to classes in globals.css; the revenue chart's data-driven bar
  height now picks a generated `bar-N` class. The previous code comment
  claiming inline attributes were unaffected was wrong.
- The local header's name/extra lengths were read at the central
  directory's offsets, so the payload offset landed mid-stream and ZIP
  inflate failed on every valid entry.
- Nonce-based CSP: `script-src` no longer allows 'unsafe-inline'. A
  per-request nonce is set on the incoming request's CSP; vinext reads
  it from the request headers and stamps it on its tags. Verified: header
  and HTML nonce match per request, nonces rotate, 0 violations.
- Removed the duplicate CSP in next.config.ts, which won on API routes
  and published 'unsafe-inline' while the page enforced a nonce.
- Security headers were configured in next.config.ts but never reached
  production (the vinext Worker build ignores Next.js `headers()`).
  Now set in worker/index.ts; all five verified live.
- WCAG AA contrast: 19 muted tones below 4.5:1 (the --muted token was
  4.22 on paper, 3.98 on tinted strips). Darkened the muted family to
  clear 4.5:1 on the darkest surface it sits on, keeping the palette.
- Dashboard heading order skipped H1 -> H3; empty states now H2.
- Decorative glyphs marked aria-hidden.
- Lint debt cleared: 18 errors to 0 (anchor-vs-Link, explicit
  any). tsc clean; security tests 12/12; build passes.
- Admin overview crashed for signed-in superadmins: the revenue chart
  aliased a computed column to bare `day`, which Neon's HTTPS SQL
  endpoint rejects (42601). Aliased to `dlabel`. All five admin
  sections now render.

### Deployed
- Worker `cursoria` redeployed twice (version 388df5c5, then
  0e9b658b after the admin fix). Prod had been serving the
  2026-09-20 build.
- First browser/E2E pass completed: public routes, magic-link
  sign-in loop, all admin sections, and the download entitlement
  gate.
