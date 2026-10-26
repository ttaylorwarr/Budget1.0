# Budget Month

Sign-in-only website to post monthly bills, tick them off as paid, and get reminded when a payment is due soon.
Runs on Cloudflare Pages (static `public/` + Pages Functions in `functions/`) with a D1 database.

## Roles
- **Owner** – exactly one. Credentials come from Cloudflare secrets (`OWNER_EMAIL`, `OWNER_PASSWORD`), never stored in the repo. Adds, edits, removes members and makes their 10-character sign-up codes.
- **Member** – signs in, or first time uses *"I have a sign-up code"* with email + code to choose a password. Each person only sees their own posts.

## Deploy on Cloudflare
1. `npm install`
2. `npx wrangler d1 create budget` → copy the `database_id` into `wrangler.toml`
3. `npm run db:init`
4. Cloudflare dashboard → Workers & Pages → Create → Pages → connect `ttaylorwarr/Budget1.0`
   (build command: none, output directory: `public`).
5. Pages project → Settings → Variables and Secrets (Production): add secrets `OWNER_EMAIL` and `OWNER_PASSWORD`.
   Settings → Bindings: D1 database, variable name `DB`, database `budget` (if not picked up from `wrangler.toml`).

## Local dev
Create `.dev.vars` (git-ignored) with `OWNER_EMAIL=...` and `OWNER_PASSWORD=...`, then `npm run dev`.
