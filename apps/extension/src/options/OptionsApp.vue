<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import {
  defaultConfig,
  isServiceRoleKey,
  loadConfig,
  saveConfig,
  type ExtensionConfig,
} from '../config.ts'
import { CONFIG_KEY, localArea, writeValue } from '../storage.ts'

const area = localArea()
const defaults = defaultConfig()
const form = reactive<ExtensionConfig>({ supabaseUrl: '', anonKey: '', webAppUrl: '' })
const saved = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  Object.assign(form, await loadConfig(area))
})

async function save() {
  saved.value = false
  error.value = null
  if (isServiceRoleKey(form.anonKey)) {
    error.value =
      'That is the service-role key. Use the public anon key; the service-role key must never leave the server.'
    return
  }
  if (form.supabaseUrl && !/^https?:\/\//.test(form.supabaseUrl.trim())) {
    error.value = 'The Supabase URL should start with https://'
    return
  }
  await saveConfig(area, form)
  Object.assign(form, await loadConfig(area))
  saved.value = true
}

async function reset() {
  await writeValue(area, CONFIG_KEY, null)
  Object.assign(form, defaultConfig())
  saved.value = true
}
</script>

<template>
  <main class="mx-auto max-w-lg space-y-6 px-6 py-10">
    <div class="flex items-center gap-3">
      <img src="/icons/icon-48.png" alt="" class="h-10 w-10" />
      <h1 class="text-xl font-bold">ApartmentTogether settings</h1>
    </div>
    <p class="text-sm text-slate-600">
      Which ApartmentTogether project the extension talks to. The defaults come from the build;
      change them if you run your own fork. Find the values in Supabase under Project Settings →
      API.
    </p>

    <form class="space-y-4" @submit.prevent="save">
      <div>
        <label class="label" for="supabaseUrl">Supabase URL</label>
        <input
          id="supabaseUrl"
          v-model="form.supabaseUrl"
          class="input"
          :placeholder="defaults.supabaseUrl || 'https://<project-ref>.supabase.co'"
        />
      </div>
      <div>
        <label class="label" for="anonKey">Anon (public) key</label>
        <input
          id="anonKey"
          v-model="form.anonKey"
          class="input font-mono"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div>
        <label class="label" for="webAppUrl">Web app URL</label>
        <input
          id="webAppUrl"
          v-model="form.webAppUrl"
          class="input"
          :placeholder="defaults.webAppUrl || 'https://<user>.github.io/<repo>/'"
        />
        <p class="mt-1 text-xs text-slate-500">Used for the "Open in the app" links.</p>
      </div>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary">Save</button>
        <button type="button" class="btn-secondary" @click="reset">Reset to defaults</button>
      </div>
    </form>

    <p v-if="saved" class="text-sm text-brand-700" data-testid="saved">Saved.</p>
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </main>
</template>
