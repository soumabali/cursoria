# Cursoria

> Storefront untuk custom cursor packs.

Live: https://cursoria.nexigo.my.id

## Stack

| Layer | Teknologi |
|-------|-----------|
| Framework | Next.js 16.2.6 (App Router, RSC) + React 19 |
| Bahasa | TypeScript 5.9 |
| Build → Worker | vinext 0.0.50 + @cloudflare/vite-plugin |
| Database | Neon PostgreSQL via HTTPS SQL endpoint |
| File storage | S3-compatible (Cloudflare R2) |
| Payments | Midtrans Snap |
| Email | Resend (magic link) |
