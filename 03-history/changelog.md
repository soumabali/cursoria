# Changelog

## [Unreleased]

### Added
- Resend outbound email wired up: Worker secrets EMAIL_API_KEY, EMAIL_FROM, SUPERADMIN_EMAIL set.

### Changed
- Open-tasks audit recorded; state verified against live prod (0 products, 0 payment_settings, no S3_* secrets).

### Fixed
- Lint debt cleared: 18 errors to 0 (anchor-vs-Link, explicit
  any). tsc clean; security tests 12/12; build passes.
