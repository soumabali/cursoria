# Cursoria — Task Board

> Single source of truth untuk task yang belum selesai.
> Update file ini setiap kali status berubah.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[!]` waiting on Dhar

## Waiting on Dhar

- [!] **Midtrans Server Key** — deferred by Dhar (2026-09-21).
      Blocked work: paid + donation checkout. `payment_settings` is
      still empty, so `/api/checkout` throws "Payments are not
      available yet."
      When ready: sign in as superadmin, open `/admin/settings`,
      pick Sandbox (production=false), paste the Server Key, tick
      "Enable checkout", save. Then set the notification URL in the
      Midtrans dashboard to
      `https://cursoria.nexigo.my.id/api/payments/webhook`
      (already shown in the form) and run one sandbox transaction
      end to end.
      Do NOT use the production key until sandbox is verified.

- [ ] **Store policies text** — needs operator decisions. `/policies`
      is still a draft outline missing: operator identity (legal
      name/entity), support contact, refund process, data-retention
      terms. Required before the store can go public.

- [ ] **Real pack content** — the catalog needs actual cursor packs.
      The store is now genuinely empty (0 products); the earlier
      verification pack has been removed.

- [ ] **Git remote + push** — the repo has no remote. GitHub auth is
      account `soumabali`; the token needs Contents: Read/Write.
      Local commits: see `git log`.

## Doable without Dhar

- [x] Deploy the lint-cleanup build to the Worker
- [x] Fix admin overview 500 (reserved SQL alias `day`)
- [x] Browser/E2E pass: public routes, magic-link sign-in, admin,
      download entitlement gate
- [x] Cloudflare R2 bucket + S3_* secrets; upload → publish → claim →
      download verified end to end
- [x] Accessibility: WCAG contrast (19 failing tones → 0), heading
      order, decorative glyphs marked aria-hidden. Verified on prod.
- [x] Security headers actually sent (they never were: vinext ignores
      next.config.ts `headers()`). Now set in worker/index.ts.
- [x] Nonce-based CSP: `script-src` no longer allows `unsafe-inline`;
      header nonce matches the HTML nonce per request. Zero violations.
- [x] Remove verification test data from production. All R2 objects and
      their DB rows deleted; superadmin account and login kept.
- [ ] Migrate inline `style=` attributes to CSS classes so `style-src`
      can also drop 'unsafe-inline' (a nonce cannot authorise style
      attributes, only <style> elements)
- [ ] Independent security review
- [ ] Malware scanning for uploaded ZIPs before a larger public launch
      (current check is file-type/path/size only, not antivirus)

## Notes

- **DB is Neon Postgres, not Cloudflare D1.** `lib/db.ts` talks to
  Neon's HTTPS `/sql` endpoint using the `DATABASE_URL` secret. The
  generated wrangler config has empty `d1_databases` and
  `db/index.ts` (drizzle/d1) is vestigial. The D1-shaped Cloudflare
  API token also cannot see the DB. Query it with the same POST body
  the app sends (`/tmp/neonq.mjs` does this).
- **Never delete the `users` row.** `sudhar.denpasar@gmail.com` is the
  only account and the store owner; there is no other way back into
  `/admin`.
- `SUPERADMIN_EMAIL` must stay set until a non-superadmin account
  exists: the sign-in upsert uses it to bootstrap the superadmin role.
  Removing the secret before then would create the owner as `role='user'`
  and lock them out of `/admin`.
- Only `STORE_PUBLIC=true` enables indexing. Until then robots.txt is
  `Disallow: /` and metadata is noindex, which is correct for a draft
  store.
- Creator payouts are manual; analytics report gross revenue before
  gateway fees, not a withdrawable balance.
- Sign-in links land on `/verify?token=...`, which renders a button
  that must be clicked — it does not auto-submit. `/signin` ignores the
  `token` param entirely.
