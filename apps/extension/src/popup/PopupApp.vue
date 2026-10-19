<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { parseListingHtml, type ParseResult } from '@at/parsers'
import { ext } from '../ext.ts'
import { isConfigured, loadConfig, type ExtensionConfig } from '../config.ts'
import { isReadableUrl, listingLink, preview, type Preview } from '../ingest.ts'
import { LAST_HUNT_KEY, PENDING_EMAIL_KEY, localArea, readValue, writeValue } from '../storage.ts'
import {
  addListing,
  createExtensionClient,
  listHunts,
  sendCode,
  verifyCode,
  type Client,
} from '../supabase.ts'
import { snapshot, targetTab } from '../tab.ts'

type Step = 'loading' | 'setup' | 'email' | 'code' | 'ready'

const area = localArea()
const logoUrl = 'icons/icon-48.png'
let client: Client

const step = ref<Step>('loading')
const config = ref<ExtensionConfig | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const email = ref('')
const code = ref('')
const userEmail = ref('')

const hunts = ref<{ id: string; name: string }[]>([])
const huntId = ref('')

const parsed = ref<{ result: ParseResult; preview: Preview } | null>(null)
const pageError = ref<string | null>(null)
const added = ref<{ link: string; existing: boolean; needsDetails: boolean } | null>(null)

onMounted(async () => {
  void readPage()
  config.value = await loadConfig(area)
  if (!isConfigured(config.value)) {
    step.value = 'setup'
    return
  }
  client = createExtensionClient(config.value, area)
  const { data } = await client.auth.getSession()
  if (data.session) {
    await enterReady(data.session.user.email ?? '')
    return
  }
  // The popup closed while the user went to fetch the code from their inbox.
  const pending = await readValue<string>(area, PENDING_EMAIL_KEY)
  email.value = pending ?? ''
  step.value = pending ? 'code' : 'email'
})

watch(huntId, (id) => {
  added.value = null
  if (id) void writeValue(area, LAST_HUNT_KEY, id)
})

async function readPage() {
  try {
    const tab = await targetTab()
    if (!tab || !isReadableUrl(tab.url)) {
      pageError.value = 'Open a listing page, then click the extension again.'
      return
    }
    const page = await snapshot(tab)
    const result = parseListingHtml(page.html, page.url)
    parsed.value = { result, preview: preview(result) }
  } catch (e) {
    pageError.value = `Can't read this page: ${(e as Error).message}`
  }
}

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = null
  try {
    await action()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const requestCode = () =>
  run(async () => {
    await sendCode(client, email.value.trim())
    await writeValue(area, PENDING_EMAIL_KEY, email.value.trim())
    code.value = ''
    step.value = 'code'
  })

const submitCode = () =>
  run(async () => {
    await verifyCode(client, email.value.trim(), code.value)
    await writeValue(area, PENDING_EMAIL_KEY, null)
    const { data } = await client.auth.getSession()
    await enterReady(data.session?.user.email ?? email.value)
  })

async function useOtherEmail() {
  await writeValue(area, PENDING_EMAIL_KEY, null)
  error.value = null
  step.value = 'email'
}

async function enterReady(signedInAs: string) {
  userEmail.value = signedInAs
  try {
    hunts.value = await listHunts(client)
  } catch (e) {
    error.value = (e as Error).message
  }
  const last = await readValue<string>(area, LAST_HUNT_KEY)
  huntId.value = hunts.value.find((h) => h.id === last)?.id ?? hunts.value[0]?.id ?? ''
  step.value = 'ready'
}

const add = () =>
  run(async () => {
    if (!parsed.value || !huntId.value) return
    const res = await addListing(client, huntId.value, parsed.value.result)
    added.value = {
      link: listingLink(config.value!.webAppUrl, huntId.value, res.listingId),
      existing: res.existing,
      needsDetails: res.needsDetails,
    }
  })

async function signOut() {
  await client.auth.signOut()
  hunts.value = []
  added.value = null
  step.value = 'email'
}

function openOptions() {
  void ext.runtime.openOptionsPage()
}
</script>

<template>
  <main class="w-[360px] space-y-3 p-4">
    <header class="flex items-center gap-2">
      <img :src="logoUrl" alt="" class="h-7 w-7" />
      <h1 class="flex-1 text-base font-bold">ApartmentTogether</h1>
      <button type="button" class="text-xs text-slate-500 hover:underline" @click="openOptions">
        Settings
      </button>
    </header>

    <p v-if="step === 'loading'" class="text-sm text-slate-500">Loading…</p>

    <div v-else-if="step === 'setup'" class="card space-y-2 text-sm" data-testid="setup">
      <p>Set the Supabase URL and anon key of your ApartmentTogether project first.</p>
      <button type="button" class="btn-primary w-full" @click="openOptions">Open settings</button>
    </div>

    <form v-else-if="step === 'email'" class="space-y-3" @submit.prevent="requestCode">
      <p class="text-sm text-slate-600">Sign in with the email you use in the web app.</p>
      <div>
        <label class="label" for="email">Email</label>
        <input
          id="email"
          v-model="email"
          type="email"
          required
          autocomplete="email"
          class="input"
          placeholder="you@example.com"
        />
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="busy">
        {{ busy ? 'Sending…' : 'Email me a sign-in code' }}
      </button>
    </form>

    <form v-else-if="step === 'code'" class="space-y-3" @submit.prevent="submitCode">
      <p class="text-sm text-slate-600">
        We emailed a code to <strong>{{ email }}</strong
        >. Enter it here (the popup can close meanwhile, it remembers).
      </p>
      <div>
        <label class="label" for="code">Code</label>
        <input
          id="code"
          v-model="code"
          required
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9 ]{6,10}"
          class="input tracking-widest"
          placeholder="123456"
        />
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="busy">
        {{ busy ? 'Checking…' : 'Sign in' }}
      </button>
      <button
        type="button"
        class="w-full text-xs text-slate-500 hover:underline"
        @click="useOtherEmail"
      >
        Use a different email
      </button>
    </form>

    <template v-else>
      <div class="flex items-center justify-between text-xs text-slate-500">
        <span data-testid="signed-in-as">{{ userEmail }}</span>
        <button type="button" class="hover:underline" @click="signOut">Sign out</button>
      </div>

      <div v-if="hunts.length">
        <label class="label" for="hunt">Hunt</label>
        <select id="hunt" v-model="huntId" class="input">
          <option v-for="h in hunts" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>
      </div>
      <p v-else class="card text-sm">
        You aren't in any hunt yet. Create or join one in the web app first.
      </p>

      <div v-if="parsed" class="card space-y-1" data-testid="preview">
        <p class="line-clamp-2 text-sm font-semibold">{{ parsed.preview.title }}</p>
        <p class="text-sm text-slate-700">
          <span class="font-semibold">{{ parsed.preview.total }}</span> ·
          {{ parsed.preview.area }} · {{ parsed.preview.rooms }} rooms
        </p>
        <p class="text-xs text-slate-500">
          Parsed {{ parsed.preview.confidence }}%<template v-if="parsed.preview.missing.length">
            · missing {{ parsed.preview.missing.join(', ') }}</template
          >
        </p>
      </div>
      <p v-else-if="pageError" class="text-sm text-slate-600">{{ pageError }}</p>
      <p v-else class="text-sm text-slate-500">Reading the page…</p>

      <div
        v-if="added"
        class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800"
        data-testid="added"
      >
        <p class="font-semibold">
          {{ added.existing ? 'Already in this hunt.' : 'Added to the hunt.' }}
        </p>
        <p v-if="added.needsDetails && !added.existing" class="text-xs">
          Some details are missing; fill them in the app.
        </p>
        <a :href="added.link" target="_blank" class="font-semibold underline">Open in the app</a>
      </div>
      <button
        v-else
        type="button"
        class="btn-primary w-full"
        :disabled="busy || !parsed || !huntId"
        @click="add"
      >
        {{ busy ? 'Adding…' : 'Add this listing' }}
      </button>
    </template>

    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </main>
</template>
