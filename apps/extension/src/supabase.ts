import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@at/shared/database'
import type { ParseResult } from '@at/parsers'
import type { ExtensionConfig } from './config.ts'
import { ingestBody, type IngestResponse } from './ingest.ts'
import { supabaseStorage, type KeyValueArea } from './storage.ts'

export type Client = SupabaseClient<Database>

/**
 * The extension has its own session (separate from the web app's), kept in
 * extension storage so it survives the popup closing.
 */
export function createExtensionClient(config: ExtensionConfig, area: KeyValueArea): Client {
  return createClient<Database>(config.supabaseUrl, config.anonKey, {
    auth: {
      storage: supabaseStorage(area),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}

// The extension never creates accounts (shouldCreateUser: false), so an unknown
// email comes back as "Signups not allowed for otp".
function describeAuthError(message: string): string {
  if (/signups not allowed|user not found/i.test(message))
    return 'No account for this email yet. Sign in to the web app once first.'
  if (/expired|invalid/i.test(message)) return 'That code is wrong or has expired.'
  return message
}

/**
 * Emails a one-time code. Magic links can't land in an extension (they open in a
 * tab, and Firefox extension origins are random), so the extension signs in
 * with the code that the same email carries. Existing users only.
 */
export async function sendCode(client: Client, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) throw new Error(describeAuthError(error.message))
}

export async function verifyCode(client: Client, email: string, code: string): Promise<void> {
  const { error } = await client.auth.verifyOtp({
    email,
    token: code.replace(/\s+/g, ''),
    type: 'email',
  })
  if (error) throw new Error(describeAuthError(error.message))
}

export async function listHunts(client: Client): Promise<{ id: string; name: string }[]> {
  const { data, error } = await client
    .from('hunts')
    .select('id, name')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function addListing(
  client: Client,
  huntId: string,
  result: ParseResult,
): Promise<IngestResponse> {
  const { data, error } = await client.functions.invoke<IngestResponse>('ingest-listing', {
    body: ingestBody(huntId, result),
  })
  if (error) {
    // FunctionsHttpError carries the JSON body with the function's error message.
    const ctx = (error as { context?: Response }).context
    const detail = ctx && (await ctx.json().catch(() => null))
    throw new Error(detail?.error ?? error.message)
  }
  return data!
}
