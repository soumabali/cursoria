# Session - Resend outbound email integration

Date: 2026-09-21
Project: Cursoria (cursoria.nexigo.my.id)

## Goal
Make
outbound email work for the Cursoria app using Resend.

## Problem
Worker `cursoria` had only APP_URL, DATABASE_URL and
SETTINGS_ENCRYPTION_KEY. EMAIL_API_KEY and EMAIL_FROM were
missing, so
 /api/auth/request threw "Email sign-in is not available yet."

## Resolution
Set three Worker secrets (values live in Obsidian credentials):
  EMAIL_API_KEY    = Resend key (source ~/.hermes/.env RESEND_API_KEY)
  EMAIL_FROM       = Cursoria
 <info@cursoria.nexigo.my.id>
  SUPERADMIN_EMAIL = sudhar.denpasar@gmail.com

Domain cursoria.nexigo.my.id must be verified in Resend first.

## Tests
Direct Resend API send -> HTTP 200, message
 id 01a0bfd7-3f06-7667-ab33-8af5f58ba140.
Live app POST /api/auth/request with Origin header -> HTTP 200,
"Check your inbox." Real sign-in email delivered.

## Note
Cloudflare Email Routing is INBOUND only; it cannot send.
Resend
 handles outbound. The key is send-restricted, so it cannot list domains.

## Inbound (separate, already working)
info@nexigo.my.id -> Cloudflare Email Routing ->
sudhar.denpasar@gmail.com (rule + catch-all enabled).
