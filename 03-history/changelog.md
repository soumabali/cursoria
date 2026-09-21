# Changelog

## [Unreleased]

### Added
- Resend outbound email wired up: Worker secrets EMAIL_API_KEY, EMAIL_FROM, SUPERADMIN_EMAIL set.

### Changed
- Open-tasks audit recorded; state verified against live prod (0 products, 0 payment_settings, no S3_* secrets).

### Fixed
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
