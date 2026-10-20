# ApartmentTogether — Build Spec

## What it is
ApartmentTogether is a web app (installable PWA) for people searching for a rental apartment together, such as a couple or flatmates. Members keep **one shared collection of listings** gathered from any listing site. They add a listing by pasting its link, sharing it from their phone, using the browser extension, or pasting the text of a post. The app scrapes the listing and keeps its own copy. Then everyone swipes, rates, compares and tracks listings until the group picks an apartment.

The first users are two people renting in Warsaw. The app is multi-user from the start, but it has no billing and no marketing site.

**Core value:** a single shared and persistent list of every listing the group is considering, along with a clear view of where the group agrees and disagrees.

## Stack
- **Frontend:** Vue 3 + TypeScript + Vite, Vue Router, Pinia, Tailwind CSS. PWA via `vite-plugin-pwa`. It is a **static SPA hosted on GitHub Pages**, with no server of its own.
- **Backend:** **Supabase free tier**. Postgres with RLS everywhere, Auth (magic link + Google), Realtime, Storage, and Edge Functions (Deno/TS). Every piece of server logic is either an edge function or a Postgres RPC.
- **Maps:** Leaflet + OpenStreetMap tiles. Geocode from an edge function, with caching and rate limiting: LocationIQ in production (Nominatim blocks Supabase's edge network), Nominatim locally.
- **Browser extension:** Manifest V3, built for Chrome and Firefox.
- **Monorepo (pnpm workspaces):**
  ```
  apps/web          Vue PWA
  apps/extension    MV3 extension
  packages/parsers  site adapters, shared by the edge function and the extension
  packages/shared   types, zod schemas, cost helpers
  supabase/         migrations, seed, edge functions
  ```

## Concepts
- **Hunt:** one apartment search, such as "Warsaw flat 2026". A hunt has members, criteria, pins and listings. A user can belong to several hunts.
- **Member:** a user in a hunt. Roles are `owner` and `member`. People join through an invite link.
- **Listing:** one apartment saved to a hunt. It is a **snapshot**, so it stays in the app even after the original ad is removed.
- **Vote:** what one member thinks of one listing: a swipe (`yes`/`maybe`/`no`) and optional 1–5 stars.
- **Match:** every member has swiped `yes` on the listing.
- **Pin:** a place the hunt cares about, such as a workplace, a station or a parent's flat. The app shows each listing's distance to every pin.

## Adding listings (all four methods)
1. **Paste link** in the app. A large "Add" button opens a URL field.
2. **Share sheet** on the phone. The PWA manifest declares a `share_target` with **`method: GET`** (`action: "<base>/#/add"` with `title`, `text`, `url` params), so the user shares straight from the Otodom or OLX app or a browser. GET works on static hosting with no service-worker handler. Some apps put the link inside `text`, so extract the first URL from `text` when `url` is empty. Images can't be shared this way; photos are added in the app.
3. **Browser extension.** One click on a listing page. The extension runs the **same parser** on the live DOM and sends the parsed data to Supabase. This also works on sites that block server-side fetching. The user picks the hunt from a dropdown.
4. **Paste text + photos** for Facebook group posts and other pages that can't be scraped. The app creates the listing from the free text plus uploaded images, and the user fills in the structured fields in a short form. The app pulls price, m² and number of rooms out of the text with regex heuristics where it can.

### Scraping pipeline
- Edge function `ingest-listing`: input is `{huntId, url}` or `{huntId, parsed}` (from the extension) or `{huntId, text, photos}`.
- Normalize the URL into a canonical form: strip tracking params, resolve redirects.
- **Dedup within the hunt.** An exact canonical URL match returns the existing listing. A fuzzy match (same price ±2%, area ±1 m², same district) prompts "Looks like a duplicate of X. Merge?"
- Fetch the HTML with a realistic UA. Pick a parser by domain from `packages/parsers`:
  - **Otodom:** `__NEXT_DATA__` JSON
  - **OLX:** embedded state JSON / JSON-LD
  - **Gratka, Morizon, Nieruchomosci-online, Domiporta:** JSON-LD/microdata first, then DOM selectors
  - **Generic fallback:** JSON-LD → OpenGraph → `<title>`/meta
- Each adapter returns a `ParsedListing` (zod-validated) plus `confidence` and `missingFields`. Partial data still saves the listing, flagged **"Needs details"** and paired with an edit form.
- **Photos are linked, not stored.** Save the source site's image URLs in `listing_photos.original_url`, ordered as on the site, and prefer the medium-size variant the CDN exposes. Render them with `referrerpolicy="no-referrer"` and `loading="lazy"`, which avoids most hotlink blocking.
- **The cover photo is the only exception.** The first image is downloaded once (the site's small/thumbnail variant, about 30–60 KB, no re-encoding) into Storage. That way a listing whose ad was taken down still has a recognisable card in the deck and the list.
- When a linked image fails to load (`onerror`), show the cached cover or a placeholder, then mark that photo `broken` so the app stops retrying it.
- Photos users upload themselves (viewing notes, Facebook posts) are the only full images stored. The browser compresses them first (`browser-image-compression`, max 1280px WebP).
- Store the raw parsed payload in `raw jsonb` for debugging.
- **Etiquette:** fetch only when a user asks to add or refresh a listing, never crawl. Rate-limit per domain.

### Liveness and price tracking
- A **daily GitHub Actions cron workflow** calls the `refresh-listings` edge function with a service-role secret. The function re-checks active listings in small batches, at most 1 request per domain every few seconds, which keeps each run inside the edge function limits. The daily call also counts as project activity, which keeps the free project from pausing.
- It records price changes in `listing_price_history` and marks listings `inactive` when the ad disappears. The snapshot stays.
- The UI shows badges such as "Price dropped 200 zł" and "Ad removed".

## Deciding together
### Swipe deck
- A Tinder-style card stack of listings the current user **hasn't voted on yet**. Listings another member has swiped `no` on **stay in the deck**. They carry a clear **"✗ Rejected by {name}"** banner and are sorted after listings nobody has rejected. Each card shows: photo carousel, total monthly cost, m², rooms, district, distance to pins, and badges for criteria it breaks.
- Swipe right = yes, left = no, up = maybe. Buttons do the same for desktop and accessibility. Undo the last swipe.
- Optional 1–5 star rating on the card or the detail view.
- **Realtime:** when a partner's swipe completes a match, show a "It's a match 🏠" toast and push notification.

### Reconsider
Any member can take a rejected listing back into consideration. This works the same whether it was their own `no` or someone else's.
- A **"Reconsider"** button sits on the rejected banner, the listing detail, and every rejected item in List or Disagreements. It accepts an optional note, such as "price dropped" or "they allow pets after all".
- Pressing it creates a `reconsider_requests` row aimed at the member who said `no`. The listing **returns to that member's deck**, pinned to the top, showing the note and who asked. That member is notified.
- When that member swipes again, the new vote replaces the old one and the request is resolved. If the answer is still `no`, the listing gets a "Still no" label and drops back down the deck. Repeated requests on the same listing are rate-limited to one open request at a time.
- When the person who rejected a listing presses Reconsider themselves, their vote is cleared and the listing returns to their deck immediately.
- All of this is written to `listing_events`.

### Matches and disagreements
- **Matches tab:** listings everyone swiped yes on, sorted by combined score.
- **Disagreements view:** listings where one member said yes and another said no, or where star ratings differ by 2 or more. These are the ones to discuss.
- **Maybes:** a separate filter.

### Combined score
- `combinedScore = average of members' stars`, with a bonus for a match. Hide each member's stars until both have voted, which avoids anchoring. This is a per-hunt toggle, on by default.

### Status pipeline
`new → contacted → viewing_booked → viewed → applied → won | rejected | gone`
- Kanban view with drag between columns. Every change is recorded in `listing_events` with user and timestamp.
- `viewing_booked` stores the date and time and offers an **.ics download**.
- After `viewed`, each member gets a short post-viewing note prompt: smell, light, noise, landlord vibe, free text, photos.

### Hunt criteria
These are set once per hunt. Breaking a criterion shows a red badge but doesn't hide the listing.
- Maximum total monthly cost
- Minimum rooms and m²
- Allowed districts / max distance to a chosen pin
- `privateOnly` (no agency, "bez pośredników")
- Pets allowed, available-from window, parking, balcony, elevator above floor N

Seed example for the first hunt: Warsaw, 3 rooms, close to SKM Służew or a station on the same SKM line, private landlords only.

## Views
- **Deck:** described above. This is the default tab on mobile.
- **List:** sortable, filterable table or card grid. Sort by total cost, cost/m², score, distance to pin, date added.
- **Map:** listings as markers coloured by vote state, plus hunt pins. Tapping a marker opens a mini card.
- **Compare:** 2–4 listings side by side, with the best value in each row highlighted.
- **Pipeline:** kanban.
- **Listing detail:** gallery, all fields, link to the original ad, price history, each member's vote and stars (after reveal), comment thread, events timeline, edit fields.
- **Hunt settings:** members, invites, criteria, pins.

## Polish rental specifics (shared/cost helpers)
- Model each cost separately: `rent`, `adminFee` (czynsz administracyjny), `utilitiesEstimate` (media), `deposit` (kaucja).
- `totalMonthly = rent + adminFee + utilitiesEstimate`. Show "czynsz + opłaty" clearly. Many ads list these separately or say "+ media".
- Fields to capture: floor/totalFloors, elevator, year built, heating type, furnished, balcony, parking, pets, available from, advertiser type (private/agency), and rental tax notes if mentioned.
- Currency: PLN. Locale: Polish formatting. UI language: English first, with i18n scaffolding (vue-i18n) so Polish can be added later.

## Data model (Postgres)
```
profiles(id uuid pk = auth.uid, display_name, avatar_url, created_at)

hunts(id, name, city, created_by, criteria jsonb, reveal_votes_after_both bool default true, created_at)
hunt_members(hunt_id, user_id, role enum(owner,member), joined_at, pk(hunt_id,user_id))
hunt_invites(id, hunt_id, token unique, created_by, expires_at, used_by, used_at)

pins(id, hunt_id, label, lat, lng, kind enum(work,station,family,other))

listings(
  id, hunt_id, added_by, source enum(otodom,olx,gratka,morizon,nieruchomosci_online,domiporta,facebook,other),
  url, canonical_url, title, description,
  rent numeric, admin_fee numeric, utilities_estimate numeric, deposit numeric,
  area_m2 numeric, rooms int, floor int, total_floors int,
  address text, district text, lat, lng,
  available_from date, advertiser_type enum(private,agency,unknown),
  features jsonb, raw jsonb, parse_confidence real, needs_details bool,
  status enum(new,contacted,viewing_booked,viewed,applied,won,rejected,gone) default 'new',
  viewing_at timestamptz, is_active bool default true, last_checked_at,
  created_at, updated_at,
  unique(hunt_id, canonical_url)
)
listing_photos(id, listing_id, original_url, storage_path null, is_cover bool, broken bool default false, position)
listing_price_history(id, listing_id, rent, admin_fee, observed_at)

votes(listing_id, user_id, swipe enum(yes,maybe,no), stars smallint check 1..5 null, updated_at, pk(listing_id,user_id))
reconsider_requests(id, listing_id, requested_by, target_user, note, created_at, resolved_at, outcome enum(yes,maybe,no) null,
  unique(listing_id, target_user) where resolved_at is null)
comments(id, listing_id, user_id, body, photo_paths text[], kind enum(comment,viewing_note), created_at)
listing_events(id, listing_id, user_id, type, payload jsonb, created_at)
```
- **Views/RPCs:** `listing_summary` (combined score, is_match, is_disagreement, my_vote, total_monthly, criteria violations) and `next_deck_cards(hunt_id, limit)`, which returns, in this order: (1) listings with an open reconsider request for the caller, (2) listings the caller hasn't voted on and nobody has rejected, (3) listings the caller hasn't voted on that another member rejected, with `rejected_by` included. Within each group, newest first.
- `request_reconsider(listing_id, note)` RPC (security definer): validates membership, creates the request, or clears the caller's own `no`.
- **RLS:** a user can read and write rows only in hunts where they are a member. Redeeming an invite uses a security-definer RPC.
- **Realtime** on `votes`, `listings`, `comments`, `listing_events`, `reconsider_requests`.

## Notifications
- Web Push from the PWA for: new match, a partner added a listing, a reconsider request for you, status changed, ad removed, price dropped. Push is sent from an edge function (`npm:web-push`, VAPID keys in Supabase secrets).
- Per-user toggles. In-app notification feed as a fallback.

## Hosting & deployment (GitHub Pages + Supabase free)
Goal: anyone can fork the repo, create a free Supabase project, set a few secrets, and have the app running at `https://<user>.github.io/<repo>/` without paying anything.

**Frontend on GitHub Pages**
- Vite `base` comes from an env var (`VITE_BASE`, default `/<repo>/`) so forks and custom domains work.
- **Use hash routing** (`createWebHashHistory`). Pages has no SPA rewrite, so deep links, magic-link redirects and the share target all need to work without a 404 hack.
- The PWA manifest `scope`/`start_url` and the service worker scope respect the base path.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` go in the build. The anon key is public by design, and RLS is what protects the data. **The service-role key never reaches the frontend or the extension.**

**Supabase free-tier constraints to design around**
- 500 MB database. Plenty for listings and text, but keep `raw jsonb` trimmed to the relevant subtree, not the whole page state.
- 1 GB file storage and 5 GB egress. Linking photos keeps both close to zero. Only cover thumbnails and user uploads live in Storage.
- 10 edge functions maximum. Keep them few: `ingest-listing`, `refresh-listings`, `geocode`, `send-push`, `redeem-invite` (or do that one as an RPC). Do everything else in SQL/RPC.
- Edge functions have tight CPU limits, so no image processing and no headless browsers. Parse only HTML/JSON.
- **Free projects pause after 7 days without activity.** The daily GitHub Action keeps the project awake. The README should explain how to un-pause from the dashboard if it pauses anyway.
- Auth: set the Site URL and redirect URLs to the Pages URL (and `http://localhost:5173` for development). The magic-link email template uses the default Supabase sender, which is fine for two users.

**CI/CD (GitHub Actions)**
- `deploy-web.yml`: on push to `main`, build `apps/web` and deploy with `actions/deploy-pages`.
- `deploy-supabase.yml`: on push to `main` touching `supabase/`, run `supabase db push` and `supabase functions deploy` using `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` repo secrets.
- `refresh.yml`: daily cron (e.g. 06:00 Europe/Warsaw), runs `curl` against the `refresh-listings` function with a shared secret header (`CRON_SECRET`) that the function checks.
- `build-extension.yml`: on tag, zip the Chrome and Firefox builds as release assets.

**Extension distribution:** no store listing. Chrome loads it unpacked from the release zip. Firefox gets it as an unlisted, AMO-signed `.xpi`. The extension has a settings page for the Supabase URL and anon key so forks work, and the user signs in with the same magic link.

**README must include:** a 10-minute setup guide (create the Supabase project, link the CLI, set secrets, enable Pages, set the auth URLs, generate VAPID keys) and a local dev guide (`supabase start`, `pnpm dev`).

## Milestones
1. **Foundation:** monorepo, Supabase schema + RLS + seed, auth, create a hunt, invite link, a member joins. **Deploy to GitHub Pages + Supabase from day one** via the workflows above.
2. **Ingest v1:** paste link → edge function → Otodom + OLX + generic parsers → listing detail page; manual edit; text+photo manual add.
3. **Deciding:** swipe deck (with rejected-by banners), stars, matches, disagreements, reconsider flow, realtime toasts.
4. **Organize:** list/sort/filter, criteria badges, pipeline kanban, comments, viewing notes, .ics.
5. **Map & pins:** geocoding, map view, distance to pins, compare view.
6. **Mobile capture:** PWA install, share_target, Web Push.
7. **Extension:** MV3 with shared parsers, hunt picker, auth via Supabase session.
8. **Upkeep:** daily liveness/price job via GitHub Actions, remaining parsers (Gratka, Morizon, Nieruchomosci-online, Domiporta), duplicate merge.

Each milestone ends with a working, deployable app.

## Testing
- **Parsers:** a fixture-based test per site in `packages/parsers/__fixtures__`, using saved HTML. Each test asserts the parsed fields. Add a fixture whenever a parser breaks.
- **RLS:** pgTAP or SQL tests showing a non-member can't read or write anything in another hunt.
- **Playwright e2e:** two users in one hunt; A adds a listing; both swipe yes; both see the match. A second scenario: B swipes no, A sees the "Rejected by B" banner, A presses Reconsider, the listing returns to the top of B's deck, B swipes yes, and it becomes a match.

## Out of scope for v1
- Billing, public landing page, native apps.
- Scheduled crawling or search alerts on listing sites.
- LLM extraction of Facebook posts. Leave an interface for it in `packages/parsers` (`extractFromText`) to be implemented later.
- Messaging landlords from inside the app.

## Notes for implementers
- Every listing site changes its markup eventually. Keep each adapter small and isolated, and make failures soft: save the listing as partial and never throw away what the user submitted.
- Prefer clear, boring code over clever abstractions. Mobile-first UI: the deck and the add flow must feel great on a phone.
- Sign-ups are restricted to `public.signup_allowlist` (added after the spec was written).
