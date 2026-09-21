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

- [!] **Policies: operator identity only** — the page itself is written
      (see Done). What remains is Dhar's to decide and I must not invent:
      the legal business name/entity, a real monitored support mailbox
      (the page shows the placeholder `CONTACT_EMAIL`), and the governing
      law. `/policies` says so explicitly in its last section.
      Everything else — retention table, deletion, refund procedure,
      cookies, security — is written and verified against real behaviour.

- [ ] **Real pack content** — the catalog needs actual cursor packs.
      The store is now genuinely empty (0 products); the earlier
      verification pack has been removed.

- [x] **Git remote + push** — pushed to `soumabali/cursoria` (main).
      Use SSH, not the token: the fine-grained token has Contents: read
      but git push returns 403. `~/.ssh/id_ed25519` is already
      authorised, so `git push origin main` just works.

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
- [x] Self-service account deletion + retention mechanism. Verified end
      to end on production (sign in, wrong-email guard, real deletion,
      DB effect, audit row, and that the deleted address cannot sign in
      again — see the regression note below).
- [x] Policies page rewritten: retention table, deletion, refund
      procedure, cookies, security. Content verified live.
- [x] Migrate inline `style=` attributes to CSS classes so `style-src`
      can also drop 'unsafe-inline'. Done — and the reason it was needed
      is sharper than assumed: `style-src` without 'unsafe-inline' blocks
      style ATTRIBUTES (`style-src-attr`). No nonce can ever authorise a
      style attribute, so the only fix is to move the style into the
      stylesheet. Verified live: 0 violations across 11 routes.
- [x] Malware/content scanning for uploaded ZIPs. The validator now
      decompresses members and checks real content against the claimed
      extension (image magic bytes, text without markup/script, cursor
      magic). Not antivirus — a determined attacker can still ship a
      malicious .cur, and that is stated in the code. 5 permanent tests.
- [x] Independent security review + policy-accuracy review. Two
      fresh-context reviewers, read-only, no production writes. Both
      delivered; findings triaged and fixed. Reports:
      `02-application/docs/security-review-independent.md` and
      `.../policy-accuracy-and-launch-readiness-review.md`.
- [x] ZIP bomb (found BY the review, and it was live: a 0.25 MB upload
      hung the Worker past 60 s and degraded the site). Fixed and verified
      in production. Note for anyone touching this: the bound must not
      rely on `maxOutputLength`, because the Workers `node:zlib` shim
      ignores it while Node honours it — the local suite passed 20/20
      while production was vulnerable.
- [x] Receipt/order-confirmation email. The only outbound mail was the
      sign-in link, so a buyer paid and received nothing. `lib/email.ts`
      now owns all outbound mail. The send is claimed with a conditional
      UPDATE before it happens — two reconciliations for one order would
      otherwise both mail the buyer, and webhook retries make that
      routine. Verified on production: claim produced receipt, repeat
      claim produced none, unpaid order not claimable.
- [x] Terms-acceptance record. The required "I agree" checkbox lived
      entirely in the browser and was never sent, so the licence was
      unprovable per customer. Now: `login_tokens.accepted` carries the
      flag across the verify gap, `users.terms_accepted_at` records first
      acceptance (COALESCE, so later sign-ins cannot rewrite it), and
      `orders.policies_accepted_at` records it per purchase. Verified
      live: accepted=true records, accepted=false does NOT.
- [ ] A security bound verified only in the Node test runner is not
      verified. Anything depending on a platform API needs testing
      against the deployed runtime too.

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
- **Sign-in tokens are `randomBytes(32).toString('hex')`, i.e. 64 hex
  chars, and only their sha256 hex is stored.** Minting a test token as
  base64url (43 chars) fails the route's `/^[0-9a-f]{64}$/` schema with
  a generic 400. `lib/security.ts` `token()` is the source of truth.
- **`email` is unique on `users`, so `ON CONFLICT(email)` drives sign-in.**
  Anything that changes a user's stored email (deletion anonymises it)
  moves the row out of the conflict target. That is why
  `deleted_identities` exists: without a separate record of the deleted
  address, the next sign-in simply inserts a fresh active row and the
  deletion is silently undone. Any future "rename email" feature needs
  the same care.
- Deleting an account arms this protection by inserting into
  `deleted_identities`; that address can never sign in again. Deleting a
  *blocked identity* is therefore not a supported operation — it would
  legitimately un-delete the account.
