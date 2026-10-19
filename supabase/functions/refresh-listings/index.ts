// Daily job, called by .github/workflows/refresh.yml with the CRON_SECRET header.
// Milestone 1: authenticates and touches the database so the free project stays awake.
// Milestone 8 adds the liveness and price re-checks.

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/rest/v1/listings?select=id&is_active=eq.true`,
    {
      method: 'HEAD',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact' },
    },
  )
  if (!res.ok) return Response.json({ ok: false, status: res.status }, { status: 500 })
  const activeListings = Number(res.headers.get('content-range')?.split('/')[1] ?? 0)

  return Response.json({ ok: true, activeListings, checked: 0 })
})
