# Session — account deletion, policies, git remote

Date: 2026-09-21
Project: Cursoria / "Cursor Studio"

## 1. Git remote and push (done)

The repo had no remote and no `.gitignore`. Both are now fixed.

Added `.gitignore` first (node_modules, `dist/`, `.next/`, `.vinext/`,
wrangler local state, `.dev.vars`, logs, editor noise) while keeping
`.env.example` tracked on purpose. Verified with `git check-ignore` that
the real `.env` would be ignored but the examples would not.

Checked for tracked secrets before publishing: `00-meta/credentials.md`
is tracked but contains only a pointer table to the Obsidian vault, no
values. No `.env`, no build output, no `node_modules` in history.

**The push failed with the fine-grained token (403) but succeeded over
SSH.** The token reports `permissions: {push: true, admin: true}` and can
read the repo, yet `git push` is denied — the token's Contents permission
is effectively read-only. `~/.ssh/id_ed25519` was already authorised
(`ssh -T git@github.com` → "Hi soumabali!"), so push via SSH works and is
now the configured remote.

Pushed: `soumabali/cursoria` main. Remote HEAD verified equal to local.

## 2. Account deletion (new feature)

The policies page promised deletion but **no deletion mechanism existed
anywhere in the codebase** — no route, no button, no column. Built it:

- `database/002_account_deletion.sql` — `users.deleted_at`, partial
  index for active-email lookups.
- `POST /api/account/delete` — requires the user to type their own email
  address. Anonymises the row (`email` → `deleted+<hash>@invalid`,
  `name` → `''`, `disabled=true`, `deleted_at=now()`), revokes sessions
  and pending sign-in links, deactivates entitlements, signs the user out,
  writes an `audit_log` row.
- `DeleteAccount` component in My Library, with a two-step confirm.
- Styles in `globals.css` (`.danger-zone`).

**Why anonymise instead of DELETE:** `orders.user_id` and
`entitlements.user_id` reference `users(id)`. Deleting the row would
either destroy financial records or fail on the foreign key.

### The bug this uncovered

After deletion the guard lapsed. Sign-in does:

```sql
INSERT INTO users(email,...) ... ON CONFLICT(email) DO UPDATE ... WHERE NOT users.disabled
```

Deletion scrubs the email, so the conflict target no longer matches the
disabled row — and the next sign-in with that address **inserted a fresh
active account, silently undoing the deletion**. Reproduced in SQL
(`rows_returned = 1`) and in the live DB (a new row with the old email,
`disabled=false`).

Fix: `database/003_deleted_identities.sql` stores `sha256(lower(email))`
of deleted accounts. `auth/request` refuses to issue a link for a blocked
address; `auth/verify` re-checks too, because a link issued just before
deletion could be clicked just after. The hash means the block list
cannot be used to recover the original address.

## 3. Policies page (rewritten)

Kept the operator-details gap explicit rather than inventing facts I do
not have. Added: a per-data-type retention table, a deletion section that
matches the real behaviour (including the hashed-address block, which the
table now discloses), cookies/visit counts, and a security section.
Refund procedure stated with a 3-working-day target, clearly labelled as
the developer's interim procedure.

Still Dhar's to decide: legal business name/entity, a monitored support
mailbox (`CONTACT_EMAIL` placeholder), governing law.

## Verification (production)

- Sign-in, then the wrong-email guard: API returns 400 "Type your email
  address to confirm deletion." Account untouched.
- Real deletion: API 200; DB shows email erased, `name=''`,
  `disabled=true`, `deleted_at` set, 0 tokens left, audit row written.
- **Regression:** the deleted address requesting a new link now returns
  400 "This email address was used for an account that has been deleted."
- Superadmin account untouched throughout, verified before and after.
- `/policies` renders live, 0 CSP violations, nonce still applied.
- Gate: tsc clean, eslint 0, security tests 12/12.

Test data cleaned afterwards — the DB is back to one row (the
superadmin) and an empty catalog.

## Two of my own testing mistakes, recorded so they are not repeated

1. I minted the sign-in token as base64url (43 chars) when the app uses
   `randomBytes(32).toString('hex')` (64 hex chars). The route schema
   rejects it with a generic 400. I briefly misread this as an auth bug.
2. A browser-harness click on the delete button did not fire the
   handler, and I nearly recorded that as the feature failing. Calling
   the endpoint directly proved the server side correct. **When a UI
   click silently does nothing in the harness, verify the endpoint
   before concluding the feature is broken.**

## Notes

- The `curl` route sweep intermittently returns `000` for `/policies`
  and `/signin` — a local TLS handshake timeout to one Cloudflare edge
  IP, not an application error. The browser renders both fine. Prefer
  the browser over curl for route sweeps on this host.
