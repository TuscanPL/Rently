// Delivers Web Push for new rows in public.notifications. Called by the database
// (trigger notify_listing_event, via pg_net) with the PUSH_WEBHOOK_SECRET header,
// not by users. The logic lives in packages/edge and is bundled into ../_shared/edge.js.
import { createSendPushHandler } from '../_shared/edge.js'

Deno.serve(
  createSendPushHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    webhookSecret: Deno.env.get('PUSH_WEBHOOK_SECRET') || undefined,
    vapid: {
      publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '',
      privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '',
      subject: Deno.env.get('VAPID_SUBJECT') || '',
    },
  }),
)
