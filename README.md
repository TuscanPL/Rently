# ApartmentTogether

A shared apartment-hunting app for couples and flatmates. Everyone in a hunt adds listings from any site into one shared list, then swipes, rates, compares and tracks them until the group agrees on a flat.

It runs as a static PWA on **GitHub Pages**, with a **Supabase free-tier** project as the backend. Hosting costs nothing.

## Repo layout

```
apps/web            Vue 3 + Vite PWA (hash routing, Pinia, Tailwind, vue-i18n)
apps/extension      MV3 browser extension (Chrome + Firefox)
packages/parsers    site adapters, shared by the edge function and the extension
packages/shared     enums, zod schemas, cost helpers, generated DB types
packages/edge       edge function logic (typed + tested in Node), bundled for Deno
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
10. **Optional, geocoding contact:** the `geocode` function looks addresses up on OpenStreetMap's Nominatim (cached, at most one request a second). Its usage policy asks for a contact address: `supabase secrets set NOMINATIM_EMAIL=you@example.com`.
11. **Web Push (milestone 6):** generate VAPID keys with `npx web-push generate-vapid-keys` and store them with `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=…`.

11. **Sign-in codes:** the browser extension signs in with the one-time code from the sign-in email, so the email must contain it. In Supabase, go to **Authentication → Email Templates → Magic Link** and paste `supabase/templates/magic_link.html`, or add `{{ .Token }}` to your own template. The local stack already uses this template (see `config.toml`). The web app accepts the code too ("Have a code? Enter it"), which helps when an installed PWA's link opens in another browser.

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
- Edge functions: `cp supabase/functions/.env.example supabase/functions/.env`, then `pnpm functions:serve`. Function logic lives in `packages/edge` and is bundled (with the parsers, zod and supabase-js) into `supabase/functions/_shared/edge.js` by `pnpm build:functions`; the deploy workflow does this before `supabase functions deploy`.

### Tests

```sh
pnpm test                             # unit + fixture tests; ingest integration tests run when the local stack is up
pnpm db:test                          # pgTAP: RLS keeps non-members out of every table
pnpm --filter @at/web e2e             # Playwright against the local stack (starts dev server + functions)
```

## Browser extension

`apps/extension` is an MV3 extension for Chrome and Firefox. On a listing page, click its toolbar button. The popup reads the page as it appears in your browser, runs the same parsers as the server (`packages/parsers`), and shows a short preview. Pick a hunt and click **Add this listing**. The parsed data goes to `ingest-listing`, which checks for duplicates and saves the listing. This also works on sites that block server-side fetching.

**Build**

```sh
cp apps/extension/.env.example apps/extension/.env.local   # optional build-time defaults
pnpm --filter @at/extension build    # dist/chrome and dist/firefox
pnpm --filter @at/extension zip      # + release/apartment-together-{chrome,firefox}-<version>.zip
```

The build-time defaults are `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_WEB_APP_URL` (the app root, used for "Open in the app" links). For Firefox, also set `EXT_GECKO_ID`. Release builds come from `.github/workflows/build-extension.yml`. Push a tag like `ext-v0.2.0` (or run the workflow by hand). The workflow uses the same `VITE_SUPABASE_*` secrets or variables as the web deploy, plus optional `VITE_WEB_APP_URL` and `EXT_GECKO_ID` variables, and attaches both zips to a GitHub release.

**Install in Chrome (unpacked):** unzip the Chrome zip, or use `dist/chrome`. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the folder. Keep the folder, because Chrome loads the extension from it.

**Install in Firefox (unlisted, AMO-signed):** Firefox only installs signed add-ons for good. Unlisted signing is free and doesn't publish anything:

1. Create API keys at https://addons.mozilla.org/developers/addon/api/key/.
2. Set a gecko id that is unique to you (`EXT_GECKO_ID=apartment-together@<you>.example`) and build.
3. `WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=… pnpm --filter @at/extension sign:firefox`. This runs `web-ext sign --channel unlisted` and writes the signed `.xpi` to `apps/extension/release/`.
4. Open the `.xpi` in Firefox to install it. For a quick test without signing, use `about:debugging` → **Load Temporary Add-on** (it is removed when Firefox restarts).

**Settings page:** right-click the toolbar button and choose **Options** (or **Manage extension → Preferences** in Firefox). Set the Supabase URL, the **anon** key, and the web app URL there to point a build at a fork. The settings page refuses the service-role key.

**Signing in:** enter your email in the popup. You get the usual sign-in email; type the 6-digit code from it into the popup. Magic links can't open inside an extension, so the extension uses the code. The popup remembers that a code is pending, so it's fine if the popup closes while you check your inbox. The extension keeps its own session in extension storage, separate from the web app, and only signs in existing accounts (sign in to the web app once first).

**Permissions:** `activeTab` and `scripting` let the extension read the current tab, and only when you click the button. `storage` holds settings and the session. A host permission covers the build-time Supabase URL. A Supabase URL set on the settings page also works, because Supabase allows cross-origin requests.

**Tests:** `pnpm --filter @at/extension test` runs the unit tests. `pnpm --filter @at/extension e2e` builds nothing itself, so run `pnpm --filter @at/extension build` first. It loads `dist/chrome` into headless Chromium, sets up the extension on its settings page, signs in with a code from Mailpit, and adds a routed Otodom fixture page to a hunt on the local stack.

## Milestones

1. **Foundation** ✅: monorepo, schema + RLS + seed, auth (magic link + Google), hunts, invite links, deploy workflows
2. **Ingest v1** ✅: paste link → `ingest-listing` → Otodom / OLX / generic parsers, listing detail + edit, add from text + photos
3. **Deciding** ✅: swipe deck, stars, matches, disagreements, reconsider, realtime toasts
4. Organize: list / sort / filter, criteria badges, pipeline kanban, comments, viewing notes, .ics
5. Map & pins: geocoding, map, distance to pins, compare
6. Mobile capture: PWA install, share target, Web Push
7. **Extension** ✅: MV3 for Chrome + Firefox with shared parsers, hunt picker, code sign-in
8. Upkeep: daily liveness / price job, remaining parsers (Gratka, Morizon, Nieruchomosci-online, Domiporta ✅), duplicate merge
