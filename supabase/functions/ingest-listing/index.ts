// Adds a listing to a hunt from a URL, extension-parsed data, or pasted text.
// The logic lives in packages/edge (typed, unit-tested) and is bundled into
// ../_shared/edge.js by `pnpm build:functions`.
import { createIngestHandler } from '../_shared/edge.js'

Deno.serve(
  createIngestHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
  }),
)
