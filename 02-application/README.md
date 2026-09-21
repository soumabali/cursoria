# Cursor Studio

English storefront for custom cursor packs. Next.js App Router + PostgreSQL, with a compatible Vinext build for the private Sites preview.

## What is implemented

- Responsive catalog, text search, category/pricing filters, price sorting, product detail, light/dark preview surfaces, guide and visible FAQs.
- Public product content; verified email magic-link sign-in required for every acquisition, including free packs. No password database.
- Three prices: free, donation with a required creator-defined minimum, and fixed price. Integer IDR amounts only.
- My Library with authenticated private ZIP delivery and order history.
- Creator product editor, preview/package uploads, draft/publish, own visits and gross sales.
- Superadmin access to all work, creator account management, and encrypted Midtrans merchant settings.
- Server-created Snap checkout, signature verification plus authenticated status reconciliation, atomic entitlements, event ledger, terminal refund protection.
- Research report: `/research`; internal canonical report and source ledger: `docs/`.

## Preview versus connected store

Without DATABASE_URL the catalog displays six labeled sample concepts. There are no seeded customer records, fake revenue, or purchasable sample downloads. `/admin` provides a read-only preview of dashboards and forms; all account/payment/write APIs return unavailable. Once DATABASE_URL is set, admin routes require a verified creator/superadmin session and only real published products appear.

The private Sites URL is a design/application preview. Its owner-only access gate prevents public Midtrans webhooks and public shoppers. It is not a live payment deployment.

## Native Next.js setup

1. Use Node.js 22.13+ and `npm ci`.
2. Copy `.env.example` to `.env.local`. Set APP_URL to the exact origin without a trailing slash. For local development use http://localhost:3000.
3. Create a Neon PostgreSQL database. Execute `database/001_init.sql` once in its SQL editor or through psql using an administrative migration account. This migration is for an empty database; do not re-run it on an initialized schema. Application SQL is parameterized and PostgreSQL-specific. The HTTPS adapter in `lib/db.ts` requires a *.neon.tech connection URL; arbitrary TCP PostgreSQL is not wired into the Workers-compatible adapter.
4. Set DATABASE_URL to an application database role with only required table/sequence privileges. Do not use production data for initial tests.
5. Set SUPERADMIN_EMAIL to the owner’s email before the first login. A new account with that address becomes superadmin only after email verification. Existing accounts are never promoted by changing this variable; an existing owner role must be changed by an authorized database migration. Clear the bootstrap variable after creating the owner.
6. Configure a Resend sending domain and set EMAIL_API_KEY / EMAIL_FROM. Send an actual sign-in link to yourself, verify it, and confirm My Library opens. No emails have been sent from this workspace.
7. Create a private S3-compatible bucket (Cloudflare R2 is supported), set S3_ENDPOINT, S3_BUCKET, S3_REGION, and bucket-scoped credentials. Do not make package objects public. The app streams authorized downloads and published previews. R2 requires region `auto`.
8. Generate SETTINGS_ENCRYPTION_KEY with `openssl rand -hex 32`. Store it in your deployment secret manager; losing or rotating it without re-encrypting records makes existing payment configuration unreadable. Never commit it.
9. Run `npm run dev:next`, or `npm run build:next` followed by `npm run start:next`.
10. Sign in as the superadmin, create creator accounts at `/admin/creators`, and configure the Midtrans sandbox Server Key at `/admin/settings`.

Use an internet-accessible HTTPS deployment for sandbox notifications. In Midtrans configure `<APP_URL>/api/payments/webhook`. Do not point Midtrans at localhost or the owner-private Sites preview. Use the production environment and key only after sandbox verification and completing the store policies. Current public policy content is a draft operational outline requiring your support contact, operator identity, refund process, and retention terms.

## Deploying the Worker

There is no `wrangler.toml` in this repository. `npm run build` emits one
at `dist/server/wrangler.json` (worker name `cursor-studio`). Deploy with:

```bash
npx wrangler deploy --name cursoria --config dist/server/wrangler.json
```

`--name cursoria` targets the existing Worker. Do not pass `--assets` on
the command line: it resolves against the current working directory and
expects `./client`, which does not exist. The generated config already
points at `dist/client`.

## SQL compatibility with the Neon HTTPS endpoint

Application SQL runs through Neon's HTTPS SQL endpoint
(`https://<host>/sql`), which is stricter than psql. A bare computed
column alias that collides with a reserved word is rejected with
PostgreSQL 42601, even though the same statement works in psql. Always
write an explicit `AS <name>` and avoid bare reserved words (`day`,
`user`, `order`, `end`, ...) as aliases.

## Hosting

Native deployment uses standard Next.js (`build:next` / `start:next`). The supplied Dockerfile runs the native Next.js build. It needs the same runtime environment variables and external services. The Sites scripts are retained for the separate Vinext/Cloudflare preview; `npm run build` builds that runtime. The two builds share application source. No public audience change was made.

Set STORE_PUBLIC=true only for the actual public store; this enables indexing and the live product sitemap. Keep the preview noindex. Product image routes are crawlable while account, admin and package download routes remain private. Validate JSON-LD and sitemap after public deployment.

## Payment behavior and important limits

- One Midtrans merchant account, set by the superadmin. Creator payouts are manual; analytics report gross revenue before gateway fees, not a withdrawable balance.
- Browser return URLs never unlock downloads. Server verification checks signature when present, order ID, IDR currency and exact amount against the authoritative Midtrans response.
- Orders retain encrypted payment settings so a merchant-key switch does not break old order verification.
- Full refund is terminal and revokes entitlement for that order. Partial refunds enter review and pause the associated download; resolve the review through an authorized database operation after assessing the actual refund. There is no automated refund or payout UI.
- A downloaded ZIP cannot be remotely removed from a customer’s device after refund.
- ZIP validation is a bounded file-type/path/size check, not antivirus. Supported entries: CUR, ANI, TXT and PNG. INF and executables are intentionally excluded; use the manual Windows installation guide. The app does not generate or certify uploaded packs.
- Aggregate analytics are all-time; revenue chart is the last 14 days. Visits are unique cookie identifier/product/day, not verified humans. Sales tables are bounded to recent records; this version has no export or pagination.
- Magic links expire in 15 minutes; sessions in 7 days. Hashes are stored, cookies are HttpOnly and SameSite=Lax, and HTTPS origins use Secure cookies. Email requests have per-address and global hourly limits. For a public high-traffic launch add edge rate limits appropriate to the hosting platform.
- The configured CSP retains unsafe-inline for framework scripts/styles. React escapes user text and JSON-LD escapes `<`; nonce-based CSP and an independent security review are recommended before claiming a hardened production deployment.

## Verification

`npm run test:security` exercises actual server modules with SQL, cookies and network boundaries mocked. Tests cover key encryption tampering, cross-origin requests, unverified acquisition, cross-creator edits, non-superadmin settings writes, download entitlement denial, forged notification, wrong payment amount, atomic-statement dispatch, refund dispatch, ZIP rejection, and disconnected preview blocking.

These tests do not prove live PostgreSQL concurrency or actual Midtrans/email/S3 behavior. `npm run build:next` validates the native framework and types. The Sites build validates the preview bundle. No browser/visual/end-to-end testing has been requested or performed.

Before production, run sandbox tests with separate creator/customer accounts for duplicate and out-of-order settlements, expired payments, correct and wrong donation amounts, free claims, replayed email links, full and partial refunds, product ownership changes, failed uploads, downloads, and key changes. Verify backups and restore. Keep real secrets out of source.
