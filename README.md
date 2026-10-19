# ApartmentTogether

A shared apartment-hunting app for couples and flatmates. Everyone in a hunt adds listings from any site into one shared list, then swipes, rates, compares and tracks them until the group agrees on a flat.

It runs as a static PWA on **GitHub Pages**, with a **Supabase free-tier** project as the backend. Hosting costs nothing.

## Repo layout

```
apps/web            Vue 3 + Vite PWA (hash routing, Pinia, Tailwind, vue-i18n)
apps/extension      MV3 browser extension (milestone 7)
packages/parsers    site adapters, shared by the edge function and the extension
packages/shared     enums, zod schemas, cost helpers, generated DB types
supabase/           migrations, seed, pgTAP tests, edge functions
.github/workflows   CI, Pages deploy, Supabase deploy, daily refresh
```

## Setup in 10 minutes

You need a GitHub account, a free [Supabase](https://supabase.com) account, and the [Supabase CLI](https://supabase.com/docs/guides/cli) (or `pnpm dlx supabase`).

1. **Fork this repo.**
2. **Create a Supabase project** (free tier). From the dashboard, note:
   - the **project ref** (in the URL: `https://supabase.com/dashboard/project/<ref>`)
   - the **database password** you chose
   - **Project Settings → API**: the project URL and the `anon` public key
3. **Create an access token** at https://supabase.com/dashboard/account/tokens.
4. **Generate the cron secret** with any random string, for example `openssl rand -hex 32`. Then set it as a function secret:
   ```sh
   supabase link --project-ref <ref>
   supabase secrets set CRON_SECRET=<the random string>
   ```
5. **Add the GitHub repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | token from step 3 |
   | `SUPABASE_PROJECT_REF` | project ref |
   | `SUPABASE_DB_PASSWORD` | database password |
   | `CRON_SECRET` | same value as step 4 |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon key (public by design; RLS protects the data) |

   Optional repo **variables**: `VITE_BASE` (set it to `/` for a custom domain; the default is `/<repo>/`) and `VITE_GOOGLE_AUTH=true` once Google sign-in is configured.

   **Never** put the service-role key in the frontend, the extension or a `VITE_` variable.
6. **Enable Pages:** Settings → Pages → Source: **GitHub Actions**.
7. **Set the auth URLs** in Supabase (Authentication → URL Configuration):
   - Site URL: `https://<user>.github.io/<repo>/`
   - Redirect URLs: `https://<user>.github.io/<repo>/**` and `http://localhost:5173/**`
8. **Deploy:** push to `main`, or run the *Deploy Supabase* and *Deploy web* workflows by hand from the Actions tab. The app goes live at `https://<user>.github.io/<repo>/`.
9. **Optional, Google sign-in:** create an OAuth client in Google Cloud and enable the Google provider under Authentication → Providers. Then set the `VITE_GOOGLE_AUTH=true` variable.
10. **Web Push (milestone 6):** generate VAPID keys with `npx web-push generate-vapid-keys` and store them with `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=…`.

### Who can sign up

Sign-ups are locked to an allowlist (`public.signup_allowlist`, seeded with the two owners' addresses in `supabase/migrations/20261019000100_email_allowlist.sql`). A trigger on `auth.users` rejects every other email, for both magic links and Google. To let someone in, run this in the Supabase SQL editor:

```sql
insert into public.signup_allowlist (entry) values ('friend@example.com');  -- one address
insert into public.signup_allowlist (entry) values ('@example.com');        -- a whole domain
```

Forks should replace the seeded addresses with their own.

Magic-link emails use Supabase's default sender. It's rate-limited, but that's fine for a handful of users. Open the link in the same browser you requested it from, because sign-in uses PKCE.

### Keeping the free project awake

Free Supabase projects pause after 7 days without activity. The daily **Refresh listings** workflow (`.github/workflows/refresh.yml`) calls the `refresh-listings` function, and that call counts as activity. If the project pauses anyway (for example because scheduled workflows got disabled in a fork with no recent commits), open the Supabase dashboard and click **Restore project**. Then re-enable the workflow under Actions.

## Local development

Requirements: Node 22+, pnpm 10, Docker.

```sh
pnpm install
pnpm db:start                         # supabase start: Postgres, Auth, Storage, Mailpit…
cp apps/web/.env.example apps/web/.env.local
# paste the anon key printed by `supabase start` (or `supabase status`) into .env.local
pnpm dev                              # http://localhost:5173
```

- Sign-in emails land in **Mailpit** at http://127.0.0.1:54324.
- The seed creates the example hunt *Warsaw flat 2026* (3 rooms, private landlords only, near SKM Służewiec / the S2–S3 line) shared by `ala@example.com` and `bartek@example.com`.
- `pnpm db:reset` re-applies migrations and the seed. `pnpm db:types` regenerates `packages/shared/src/database.ts` after a schema change.
- Edge functions: `cp supabase/functions/.env.example supabase/functions/.env && supabase functions serve --env-file supabase/functions/.env`.

### Tests

```sh
pnpm test                             # unit tests (shared helpers, parsers)
pnpm db:test                          # pgTAP: RLS keeps non-members out of every table
pnpm --filter @at/web e2e             # Playwright against the local stack
```

## Milestones

1. **Foundation** ✅: monorepo, schema + RLS + seed, auth (magic link + Google), hunts, invite links, deploy workflows
2. Ingest v1: paste link → `ingest-listing` → Otodom / OLX / generic parsers, manual add from text + photos
3. Deciding: swipe deck, stars, matches, disagreements, reconsider, realtime toasts
4. Organize: list / sort / filter, criteria badges, pipeline kanban, comments, viewing notes, .ics
5. Map & pins: geocoding, map, distance to pins, compare
6. Mobile capture: PWA install, share target, Web Push
7. Extension: MV3 with shared parsers
8. Upkeep: daily liveness / price job, remaining parsers, duplicate merge
