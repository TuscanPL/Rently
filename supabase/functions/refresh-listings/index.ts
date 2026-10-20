// Daily liveness and price re-check. Called by .github/workflows/refresh.yml with
// the CRON_SECRET header (which also keeps the free project awake), and by the
// "Check now" button on a listing with the member's JWT and { listingId }.
// The logic lives in packages/edge and is bundled into ../_shared/edge.js by
// `pnpm build:functions`.
import { createRefreshHandler } from '../_shared/edge.js'

Deno.serve(
  createRefreshHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    cronSecret: Deno.env.get('CRON_SECRET') || undefined,
  }),
)
