// Adds a listing to a hunt from a URL, extension-parsed data, or pasted text.
// The logic lives in packages/edge (typed, unit-tested) and is bundled into
// ../_shared/edge.js by `pnpm build:functions`.
import { createGeocoder, createIngestHandler } from '../_shared/edge.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!

Deno.serve(
  createIngestHandler({
    supabaseUrl,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    // Listings without coordinates get geocoded from their address; kept short so
    // a busy or unreachable Nominatim never holds up adding a listing for long.
    geocode: createGeocoder({
      supabaseUrl,
      serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      nominatimEmail: Deno.env.get('NOMINATIM_EMAIL') || undefined,
      maxWaitMs: 2500,
      timeoutMs: 4000,
    }),
  }),
)
