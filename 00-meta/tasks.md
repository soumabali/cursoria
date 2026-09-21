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
      Currently only a verification pack ("Matcha Moments", free)
      exists. See "Cleanup" below.

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
- [ ] Remove verification test data from production (see Cleanup)
- [ ] Accessibility audit (W3C target-size applied; no conformance
      audit performed)
- [ ] Nonce-based CSP + independent security review (CSP currently
      retains unsafe-inline for framework scripts/styles)
- [ ] Malware scanning for uploaded ZIPs before a larger public launch
      (current check is file-type/path/size only, not antivirus)

## Cleanup: verification artifacts in production

Created while proving the storage chain (2026-09-21). Real rows, not
seeded samples. There is no product-delete UI, so removal is SQL-only.

| Artifact | Detail |
|----------|--------|
| product | slug `matcha-moments`, free, published |
| uploads | 4 rows (2 preview, 2 package) under the owner account |
| order | Rp0, status paid, free claim |
| entitlement | active, owner account ↔ the test product |

R2 objects: `cursoria-packs/<owner-id>/<hash>.{png,zip}` — 4 objects.
Rows must go before the objects, and the entitlement/order before the
product (foreign keys).

## Notes

- `SUPERADMIN_EMAIL` must stay set until a non-superadmin account
  exists: the sign-in upsert uses it to bootstrap the superadmin role.
  Removing the secret before then would create the owner as `role='user'`
  and lock them out of `/admin`.
- Only `STORE_PUBLIC=true` enables indexing. Until then robots.txt is
  `Disallow: /` and metadata is noindex, which is correct for a draft
  store.
- Creator payouts are manual; analytics report gross revenue before
  gateway fees, not a withdrawable balance.
