// Refreshes a saved Otodom search when a member pulls to refresh in Browse.
// Never scheduled. The logic lives in packages/edge and is bundled into
// ../_shared/edge.js.
import { createSearchHandler } from '../_shared/edge.js'

Deno.serve(
  createSearchHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  }),
)
