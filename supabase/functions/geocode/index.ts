// Turns an address into coordinates for pins and listings: Nominatim, cached in
// public.geocode_cache and throttled to one request a second across instances.
// The logic lives in packages/edge and is bundled into ../_shared/edge.js.
import { createGeocodeHandler } from '../_shared/edge.js'

Deno.serve(
  createGeocodeHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    nominatimEmail: Deno.env.get('NOMINATIM_EMAIL') || undefined,
  }),
)
