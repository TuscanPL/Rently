import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { authRedirectUrl, supabase, type Tables } from '@/lib/supabase'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const profile = ref<Tables<'profiles'> | null>(null)
  const authError = ref<string | null>(null)
  let ready: Promise<void> | null = null

  const userId = computed(() => session.value?.user.id ?? null)

  async function loadProfile() {
    if (!userId.value) {
      profile.value = null
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId.value).single()
    profile.value = data
  }

  /** Resolves once supabase-js has picked up any ?code= from a magic link or OAuth redirect. */
  function init(): Promise<void> {
    ready ??= (async () => {
      const params = new URLSearchParams(window.location.search)
      authError.value = params.get('error_description')
      const { data } = await supabase.auth.getSession()
      session.value = data.session
      if (params.has('code') || params.has('error')) {
        // Drop auth params so a reload doesn't retry them; keep the hash route.
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      }
      supabase.auth.onAuthStateChange((_event, s) => {
        const changed = s?.user.id !== session.value?.user.id
        session.value = s
        if (changed) void loadProfile()
      })
      await loadProfile()
    })()
    return ready
  }

  async function sendMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    })
    if (error) throw error
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirectUrl() },
    })
    if (error) throw error
  }

  async function updateDisplayName(displayName: string) {
    if (!userId.value) return
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: displayName })
      .eq('id', userId.value)
      .select()
      .single()
    if (error) throw error
    profile.value = data
  }

  async function signOut() {
    await supabase.auth.signOut()
    session.value = null
    profile.value = null
  }

  return {
    session,
    profile,
    userId,
    authError,
    init,
    sendMagicLink,
    signInWithGoogle,
    updateDisplayName,
    signOut,
  }
})
