// Public transport trips from listings to the hunt's pins, planned with
// Transitous and stored in public.listing_routes (looked up once, then kept).
// The logic lives in packages/edge and is bundled into ../_shared/edge.js.
import { createTransitHandler } from '../_shared/edge.js'

Deno.serve(
  createTransitHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    transitousUrl: Deno.env.get('TRANSITOUS_URL') || undefined,
  }),
)
