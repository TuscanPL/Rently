<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase, type Tables } from '@/lib/supabase'
import { useHuntsStore } from '@/stores/hunts'
import { useAuthStore } from '@/stores/auth'
import PinsSection from '@/components/PinsSection.vue'

const { t, d } = useI18n()
const router = useRouter()
const huntsStore = useHuntsStore()
const auth = useAuthStore()

const name = ref('')
const city = ref('')
const savingDetails = ref(false)
const error = ref<string | null>(null)

const invites = ref<Tables<'hunt_invites'>[]>([])
const creatingInvite = ref(false)
const copiedId = ref<string | null>(null)
const canShare = typeof navigator.share === 'function'

watchEffect(() => {
  if (huntsStore.current) {
    name.value = huntsStore.current.name
    city.value = huntsStore.current.city
  }
})

function inviteUrl(token: string) {
  return new URL(`${import.meta.env.BASE_URL}#/join/${token}`, window.location.origin).toString()
}

async function run(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function loadInvites() {
  const { data, error: err } = await supabase
    .from('hunt_invites')
    .select('*')
    .eq('hunt_id', huntsStore.current!.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
  if (err) throw err
  invites.value = data
}

onMounted(() => run(loadInvites))

async function saveDetails() {
  savingDetails.value = true
  await run(() => huntsStore.updateHunt({ name: name.value.trim(), city: city.value.trim() }))
  savingDetails.value = false
}

function toggleReveal(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  void run(() => huntsStore.updateHunt({ reveal_votes_after_both: checked }))
}

async function createInvite() {
  creatingInvite.value = true
  await run(async () => {
    const { data, error: err } = await supabase
      .from('hunt_invites')
      .insert({ hunt_id: huntsStore.current!.id })
      .select()
      .single()
    if (err) throw err
    invites.value.unshift(data)
  })
  creatingInvite.value = false
}

async function shareInvite(invite: Tables<'hunt_invites'>) {
  const url = inviteUrl(invite.token)
  if (canShare) {
    try {
      await navigator.share({
        text: t('settings.inviteShareText', { name: huntsStore.current!.name }),
        url,
      })
      return
    } catch {
      // Cancelled or unsupported: fall through to copying.
    }
  }
  await copyInvite(invite)
}

async function copyInvite(invite: Tables<'hunt_invites'>) {
  try {
    await navigator.clipboard.writeText(inviteUrl(invite.token))
    copiedId.value = invite.id
    setTimeout(() => (copiedId.value = null), 2000)
  } catch {
    // Clipboard blocked: the link stays visible to copy by hand.
  }
}

function revokeInvite(id: string) {
  void run(async () => {
    const { error: err } = await supabase.from('hunt_invites').delete().eq('id', id)
    if (err) throw err
    invites.value = invites.value.filter((i) => i.id !== id)
  })
}

function removeMember(userId: string, displayName: string) {
  if (!confirm(t('settings.removeConfirm', { name: displayName }))) return
  void run(() => huntsStore.removeMember(userId))
}

function leave() {
  if (!confirm(t('settings.leaveConfirm'))) return
  void run(async () => {
    await huntsStore.removeMember(auth.userId!)
    await router.replace({ name: 'hunts' })
  })
}

function deleteHunt() {
  if (!confirm(t('settings.deleteConfirm', { name: huntsStore.current!.name }))) return
  void run(async () => {
    await huntsStore.deleteHunt()
    await router.replace({ name: 'hunts' })
  })
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-xl font-bold">{{ t('settings.title') }}</h2>
    <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
      {{ t('common.error', { message: error }) }}
    </p>

    <section class="card space-y-4">
      <h3 class="font-semibold">{{ t('settings.details') }}</h3>
      <form class="space-y-3" @submit.prevent="saveDetails">
        <fieldset :disabled="!huntsStore.isOwner" class="space-y-3">
          <div>
            <label class="label" for="hunt-name">{{ t('hunts.name') }}</label>
            <input id="hunt-name" v-model="name" required maxlength="100" class="input" />
          </div>
          <div>
            <label class="label" for="hunt-city">{{ t('hunts.city') }}</label>
            <input id="hunt-city" v-model="city" required class="input" />
          </div>
          <label class="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              class="mt-0.5 h-5 w-5 accent-brand-700"
              :checked="huntsStore.current?.reveal_votes_after_both"
              @change="toggleReveal"
            />
            {{ t('settings.reveal') }}
          </label>
          <button
            v-if="huntsStore.isOwner"
            type="submit"
            class="btn-primary"
            :disabled="savingDetails"
          >
            {{ savingDetails ? t('common.saving') : t('common.save') }}
          </button>
        </fieldset>
        <p v-if="!huntsStore.isOwner" class="text-xs text-slate-500">
          {{ t('settings.ownerOnly') }}
        </p>
      </form>
    </section>

    <section class="card">
      <h3 class="mb-3 font-semibold">{{ t('settings.members') }}</h3>
      <ul class="divide-y divide-slate-100" data-testid="members">
        <li v-for="m in huntsStore.members" :key="m.user_id" class="flex items-center gap-3 py-2">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800"
          >
            {{ m.profiles?.display_name.charAt(0).toUpperCase() }}
          </span>
          <span class="flex-1">
            <span class="block font-medium">
              {{ m.profiles?.display_name }}
              <span v-if="m.user_id === auth.userId" class="text-slate-400"
                >({{ t('settings.you') }})</span
              >
            </span>
            <span class="text-xs text-slate-500">{{ t(`settings.${m.role}`) }}</span>
          </span>
          <button
            v-if="huntsStore.isOwner && m.user_id !== auth.userId"
            type="button"
            class="text-sm text-rose-700"
            @click="removeMember(m.user_id, m.profiles?.display_name ?? '')"
          >
            {{ t('settings.remove') }}
          </button>
        </li>
      </ul>
    </section>

    <section class="card space-y-3">
      <h3 class="font-semibold">{{ t('settings.invites') }}</h3>
      <p class="text-sm text-slate-600">{{ t('settings.invitesHelp') }}</p>
      <ul class="space-y-2">
        <li v-for="inv in invites" :key="inv.id" class="rounded-xl bg-slate-50 p-3">
          <input
            readonly
            class="w-full truncate bg-transparent font-mono text-xs text-slate-700 outline-none"
            :value="inviteUrl(inv.token)"
            data-testid="invite-url"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <div class="mt-2 flex items-center gap-3 text-sm">
            <span class="flex-1 text-xs text-slate-500">
              {{ t('settings.expires', { date: d(new Date(inv.expires_at), 'short') }) }}
            </span>
            <button v-if="canShare" type="button" class="text-brand-700" @click="shareInvite(inv)">
              {{ t('common.share') }}
            </button>
            <button type="button" class="text-brand-700" @click="copyInvite(inv)">
              {{ copiedId === inv.id ? t('common.copied') : t('common.copy') }}
            </button>
            <button type="button" class="text-rose-700" @click="revokeInvite(inv.id)">
              {{ t('settings.revoke') }}
            </button>
          </div>
        </li>
      </ul>
      <button
        type="button"
        class="btn-primary w-full"
        :disabled="creatingInvite"
        @click="createInvite"
      >
        {{ t('settings.createInvite') }}
      </button>
    </section>

    <PinsSection />

    <section class="card space-y-3">
      <h3 class="font-semibold text-rose-700">{{ t('settings.dangerZone') }}</h3>
      <div class="flex flex-wrap gap-3">
        <button v-if="!huntsStore.isOwner" type="button" class="btn-danger" @click="leave">
          {{ t('settings.leave') }}
        </button>
        <button v-if="huntsStore.isOwner" type="button" class="btn-danger" @click="deleteHunt">
          {{ t('settings.delete') }}
        </button>
      </div>
    </section>
  </div>
</template>
