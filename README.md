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
10. **Geocoding key:** address search and placing new listings on the map need a geocoder. Nominatim (OpenStreetMap) refuses requests from Supabase's edge network with 403, so deployed functions use [LocationIQ](https://locationiq.com) (free tier: 5,000 requests a day, 2 a second), which has the same API. Create a free access token and set it: `supabase secrets set LOCATIONIQ_KEY=<token>`. Without the key the functions fall back to Nominatim, which works for local development; there you can set `NOMINATIM_EMAIL=you@example.com` as its usage policy asks.
11. **Web Push.** Without these steps the in-app notification feed (the 🔔) still works; only push to phones and desktops is off.
    1. Generate VAPID keys once: `npx web-push generate-vapid-keys`. Store them as function secrets, with a contact for push services, and pick a random shared secret for the database → function call:
       ```sh
       supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
         VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=$(openssl rand -hex 32)
       ```
    2. Add the **public** key as the `VITE_VAPID_PUBLIC_KEY` repo variable (or secret) so the web build can subscribe browsers. The private key never goes into a `VITE_` variable.
    3. Tell the database where `send-push` lives. A trigger on `listing_events` calls it with `pg_net`, reading the URL and the shared secret from Supabase Vault. In the SQL editor:
       ```sql
       select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push', 'send_push_url');
       select vault.create_secret('<same value as PUSH_WEBHOOK_SECRET>', 'push_webhook_secret');
       ```
       To change one later: `select vault.update_secret((select id from vault.secrets where name = 'send_push_url'), '<new value>');`
    4. Each person turns push on per device under **Account → Notifications**. On iPhone/iPad, push only works once the app is added to the home screen (iOS 16.4+).

12. **Sign-in codes:** the browser extension signs in with the one-time code from the sign-in email, so the email must contain it. In Supabase, go to **Authentication → Email Templates → Magic Link** and paste `supabase/templates/magic_link.html`, or add `{{ .Token }}` to your own template. The local stack already uses this template (see `config.toml`). The web app accepts the code too ("Have a code? Enter it"), which helps when an installed PWA's link opens in another browser.

### Who can sign up

Sign-ups are locked to an allowlist (`public.signup_allowlist`, created empty by `supabase/migrations/20261019000100_email_allowlist.sql`, so nobody can sign up until you add yourself). A trigger on `auth.users` rejects every other email, for both magic links and Google. After the first deploy, add your own addresses; to let someone in later, do the same. Run this in the Supabase SQL editor:

```sql
insert into public.signup_allowlist (entry) values ('friend@example.com');  -- one address
insert into public.signup_allowlist (entry) values ('@example.com');        -- a whole domain
```

Forks should replace the seeded addresses with their own.

Magic-link emails use Supabase's default sender. It's rate-limited, but that's fine for a handful of users. Open the link in the same browser you requested it from, because sign-in uses PKCE.

### Daily refresh: liveness and prices

The **Refresh listings** workflow (`.github/workflows/refresh.yml`) runs every morning at 04:00 UTC and POSTs to the `refresh-listings` function with the `x-cron-secret` header. Each call re-checks a batch of up to 20 listings that have a link, oldest check first. It skips listings checked in the last 20 hours, listings with status won / rejected / gone, and ads already marked removed unless they were last checked over 7 days ago (so one that comes back is noticed). Requests go out at most once per site every 4 seconds; different sites are checked side by side. No new fetch starts after 100 seconds, to stay inside the edge function's wall-clock limit. The call answers with a summary such as `{"checked":20,"unchanged":17,"priceChanged":1,"removed":1,"restored":0,"unknown":1,"remaining":12}`. The workflow calls again while `remaining` is above 0, up to 8 times; anything left waits for the next day. It fails on any non-2xx answer.

For each ad:

- **Removed**: 404 or 410, a redirect to a search or category page instead of the ad, or an "ogłoszenie nieaktualne / wygasło / zakończone" notice. The listing is marked *Ad removed* (`is_active = false`); everything saved stays. If the ad comes back later, the listing becomes active again.
- **Price changed**: the page still parses as a listing and the rent or admin fee differs. The new price is saved, added to the price history, and the cards show "Price dropped 200 zł" or "Price up 150 zł" for two weeks. A price is only taken from a confident parse, and never from a jump of more than 60 %, which is more likely a misread. Other fields are never overwritten, so your edits stay.
- **Unknown**: network errors, timeouts, 403 / 429 / 5xx, bot walls, or a page that doesn't look like a listing. Nothing changes except the check time. An ad is never marked removed on a guess.

Events (`price_changed`, `ad_removed`, `ad_restored`) land in each listing's history. A member can also press **Check now** on a listing, which uses the same function and the same per-site throttle.

Run it locally with `pnpm functions:serve` and `curl -X POST -H "x-cron-secret: local-cron-secret" http://127.0.0.1:54321/functions/v1/refresh-listings`. To trigger it in production, run the workflow by hand from the Actions tab.

### Keeping the free project awake

Free Supabase projects pause after 7 days without activity. The daily refresh call counts as activity, even when nothing is due. If the project pauses anyway (for example because scheduled workflows got disabled in a fork with no recent commits), open the Supabase dashboard and click **Restore project**. Then re-enable the workflow under Actions.

### Duplicates

Adding a listing that matches another one in the hunt (same price ±2 %, area ±1 m², same district) shows "Looks like a duplicate of X" with **Delete this one**, **Keep both** and **Merge into X**. Merging keeps the older listing and fills its empty fields from the new one (its own values always win). It combines the features and moves photos, comments, price history and history events over. Each member keeps their vote on the older listing; a vote only on the new one moves over. The merged ad's link is remembered, so adding it again opens the kept listing.

### Browsing an Otodom search

List → **Browse Otodom** shows the results of a saved Otodom search inside the app. There are two ways to set one up:

- **Set filters**: pick the city and district, max rent, rooms and minimum m², and whether to show private owners only. **Use our hunt criteria** fills these from the hunt's settings. The app writes the Otodom results link for you, and **Check this search on Otodom ↗** opens it so you can see it's the right search.
- **Paste a link**: set your filters on otodom.pl, copy the results page address and paste it in.

Each result card has the photo, price, m², rooms, district and private/agency. Tapping it opens the full ad inside the app: description, all photos, deposit, floor, features. The full ad is read from Otodom the first time anyone opens that card, then kept in `search_results.detail`, so opening it again doesn't fetch. **Add to hunt** saves the listing from that stored ad without fetching again and puts it in everyone's deck; **Add as liked** does the same and records your yes, so only your partner gets it in their deck. **Hide** removes the card for everyone in the hunt. The cards are stored in `search_results`, so everyone in the hunt sees the same list.

Results are fetched **only when someone asks**, never in the background:

- Pulling down (or tapping Refresh) reads page 1, the newest ads.
- Scrolling to the end of the list (or tapping **Load more**) reads the next page. There's no page limit, so you can scroll through the whole search.

The `search-refresh` edge function goes through the same per-site throttle as adding a listing (one Otodom request every 4 seconds). It skips a refresh if the search was refreshed less than a minute ago. Ads first seen in a later refresh are marked **New** for a day; older ads reached by scrolling are not.

### Public transport trips

Every listing shows how long it takes by public transport to each of the hunt's pins. Each pin has an **arrive by** day and time (default: Tuesday 9:00 Warsaw time; a family pin might be Saturday 12:00). The `transit-routes` edge function plans the trip for the next such day with [Transitous](https://transitous.org), a free, community-run journey planner built on the open timetables (ZTM, SKM, KM, WKD). No key or account is needed.

Trips are looked up **once** and stored in `listing_routes`. A trip is planned again only when the listing or the pin moves, or the pin's arrival time changes. The app asks for missing trips by itself, in small batches spaced one second apart. A failed lookup is shown as such and retried after six hours. If Transitous changes its API version, point the function at the new endpoint with `supabase secrets set TRANSITOUS_URL=https://api.transitous.org/api/vN/plan`. Failures are logged in the function's logs with Transitous's answer.

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
- Edge functions: `cp supabase/functions/.env.example supabase/functions/.env`, then `pnpm functions:serve`. For Web Push locally, generate VAPID keys (`npx web-push generate-vapid-keys`), put them in `supabase/functions/.env` and the public one in `apps/web/.env.local` as `VITE_VAPID_PUBLIC_KEY`. The seed already stores the Vault secrets that point the notification trigger at the local `send-push` (`http://kong:8000/…`, as seen from the db container). Push needs the service worker, which only the built app has: `pnpm build && pnpm --filter @at/web preview`. Function logic lives in `packages/edge` and is bundled (with the parsers, zod and supabase-js) into `supabase/functions/_shared/edge.js` by `pnpm build:functions`; the deploy workflow does this before `supabase functions deploy`.

### Tests

```sh
pnpm test                             # unit + fixture tests; edge function integration tests run when the local stack is up
pnpm db:test                          # pgTAP: RLS, deck, re-check bookkeeping, duplicate merge
pnpm --filter @at/web e2e             # Playwright against the local stack (starts dev server + functions)
```

## Phone: install, share, notifications

- **Install:** Chrome on Android and desktop offers *Install app* (on the hunts list and the account page). On iPhone, use Share → *Add to Home Screen*.
- **Share a listing:** once installed on Android, ApartmentTogether appears in the share sheet of Otodom, OLX and the browser. The share opens `#/add`: pick the hunt (the last one you opened is preselected; with one hunt there's nothing to pick) and the add flow opens with the link filled in. Apps that put the link inside the shared text work too. Signed out? Sign in and you land back in the add flow.
- **Notifications:** new matches, listings a partner added, reconsider requests aimed at you, status changes, ads taken down and price drops. They show up under the 🔔 (live) and, if you turn push on for a device, as system notifications. You never get notified about your own actions. Each kind can be switched off under Account → Notifications.

How it works: every notification starts as a `listing_events` row. The `listing_events_notify` trigger (`supabase/migrations/20261024000000_notifications.sql`) writes one `notifications` row per recipient and posts their ids to the `send-push` function with `pg_net`. `send-push` (`packages/edge/src/push.ts`) loads the recipients' `push_subscriptions` and sends Web Push (RFC 8291 encryption and VAPID with WebCrypto, `packages/edge/src/webpush.ts`). Subscriptions the push service has forgotten (404/410) are deleted. The service worker (`apps/web/src/sw.ts`, built with vite-plugin-pwa's `injectManifest`) shows the notification and opens the right screen when it's tapped.

### Updates to the installed app

A new deploy is picked up without reinstalling. The app checks for a new version on launch, whenever it comes back to the foreground (at most once a minute) and every 30 minutes while open. A new version downloads in the background and waits. A banner then says **"A new version of the app is ready"**, and **Update** switches to it and reloads, so nobody loses a half-typed form. **Later** hides the banner, and the update stays ready for next time. Account → **App version** shows the commit and build time, with a **Check for updates** button. `pnpm --filter @at/web e2e:update` tests the whole flow against two real production builds.

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
3. **Deciding** ✅: swipe deck, matches, disagreements, reconsider, realtime toasts (star ratings were removed)
4. **Organize** ✅: list sort / filter, criteria badges, pipeline kanban, comments, viewing notes, .ics
5. **Map & pins** ✅: geocoding, pins, map, distance to pins, compare
6. **Mobile capture** ✅: PWA install, share target, Web Push, in-app notification feed
7. **Extension** ✅: MV3 for Chrome + Firefox with shared parsers, hunt picker, code sign-in
8. **Upkeep** ✅: daily liveness / price job with "Check now", price badges, remaining parsers (Gratka, Morizon, Nieruchomosci-online, Domiporta), duplicate merge
