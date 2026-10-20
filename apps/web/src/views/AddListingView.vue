<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { extractFromText, firstUrl } from '@at/parsers'
import { draftFromParsed, draftToFields, ingest, type ListingDraft } from '@/lib/listings'
import { uploadPhoto } from '@/lib/photos'
import { useListingsStore } from '@/stores/listings'
import ListingForm from '@/components/ListingForm.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const listingsStore = useListingsStore()
const huntId = route.params.huntId as string

const query = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '')
const prefillUrl = query('url') || firstUrl(query('text')) || ''

const mode = ref<'link' | 'text'>(query('text') && !prefillUrl ? 'text' : 'link')
const url = ref(prefillUrl)
const text = ref(query('text'))
const files = ref<{ file: File; preview: string }[]>([])
const step = ref<'input' | 'form'>('input')
const draft = ref<ListingDraft | null>(null)
const busy = ref<string | null>(null)
const error = ref<string | null>(null)
const canPaste = typeof navigator.clipboard?.readText === 'function'

const urlValid = computed(() => {
  try {
    return /^https?:$/.test(new URL(url.value.trim()).protocol)
  } catch {
    return false
  }
})

async function paste() {
  try {
    const clip = await navigator.clipboard.readText()
    url.value = firstUrl(clip) ?? clip.trim()
  } catch {
    // Permission denied: the user can long-press and paste.
  }
}

async function finish(promise: Promise<Awaited<ReturnType<typeof ingest>>>) {
  error.value = null
  try {
    const res = await promise
    listingsStore.lastIngest = res
    await router.replace({ name: 'listing', params: { huntId, listingId: res.listingId } })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = null
  }
}

function addLink() {
  busy.value = t('add.fetching')
  void finish(ingest({ huntId, url: url.value.trim() }))
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of input.files ?? []) {
    if (file.type.startsWith('image/'))
      files.value.push({ file, preview: URL.createObjectURL(file) })
  }
  input.value = ''
}

function removeFile(i: number) {
  const [removed] = files.value.splice(i, 1)
  if (removed) URL.revokeObjectURL(removed.preview)
}

function toForm() {
  const parsed = extractFromText(text.value)
  draft.value = draftFromParsed({ ...parsed, url: firstUrl(text.value) })
  step.value = 'form'
}

function saveText() {
  const d = draft.value!
  void finish(
    (async () => {
      const photoPaths: string[] = []
      for (const [i, f] of files.value.entries()) {
        busy.value = t('add.uploading', { n: i + 1, total: files.value.length })
        photoPaths.push(await uploadPhoto(huntId, f.file))
      }
      busy.value = t('common.saving')
      return ingest({
        huntId,
        text: text.value,
        url: d.url.trim() || undefined,
        fields: draftToFields(d),
        photoPaths,
      })
    })(),
  )
}

onBeforeUnmount(() => files.value.forEach((f) => URL.revokeObjectURL(f.preview)))
</script>

<template>
  <div class="space-y-5">
    <h2 class="text-xl font-bold">{{ t('add.title') }}</h2>

    <div
      v-if="step === 'input'"
      class="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold"
      role="tablist"
    >
      <button
        v-for="m in ['link', 'text'] as const"
        :key="m"
        type="button"
        role="tab"
        :aria-selected="mode === m"
        class="rounded-lg py-2"
        :class="mode === m ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'"
        @click="mode = m"
      >
        {{ t(`add.mode.${m}`) }}
      </button>
    </div>

    <form v-if="step === 'input' && mode === 'link'" class="space-y-4" @submit.prevent="addLink">
      <div>
        <label class="label" for="add-url">{{ t('add.urlLabel') }}</label>
        <div class="flex gap-2">
          <input
            id="add-url"
            v-model="url"
            type="url"
            inputmode="url"
            required
            autofocus
            class="input"
            placeholder="https://www.otodom.pl/pl/oferta/…"
          />
          <button v-if="canPaste" type="button" class="btn-secondary shrink-0" @click="paste">
            {{ t('add.paste') }}
          </button>
        </div>
        <p class="mt-1 text-xs text-slate-500">{{ t('add.urlHelp') }}</p>
      </div>
      <button
        type="submit"
        class="btn-primary w-full py-3 text-base"
        :disabled="!urlValid || !!busy"
      >
        {{ busy ?? t('add.addButton') }}
      </button>
    </form>

    <form v-else-if="step === 'input'" class="space-y-4" @submit.prevent="toForm">
      <div>
        <label class="label" for="add-text">{{ t('add.textLabel') }}</label>
        <textarea
          id="add-text"
          v-model="text"
          rows="8"
          class="input"
          :placeholder="t('add.textPlaceholder')"
        />
      </div>
      <div>
        <span class="label">{{ t('add.photos') }}</span>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="(f, i) in files"
            :key="f.preview"
            class="relative h-20 w-20 overflow-hidden rounded-xl"
          >
            <img :src="f.preview" alt="" class="h-full w-full object-cover" />
            <button
              type="button"
              class="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-slate-900/70 text-xs text-white"
              :aria-label="t('add.removePhoto')"
              @click="removeFile(i)"
            >
              ✕
            </button>
          </div>
          <label
            class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-xs text-slate-500"
          >
            <span class="text-2xl">＋</span>{{ t('add.addPhotos') }}
            <input
              type="file"
              accept="image/*"
              multiple
              class="sr-only"
              data-testid="photo-input"
              @change="onFiles"
            />
          </label>
        </div>
      </div>
      <button
        type="submit"
        class="btn-primary w-full py-3 text-base"
        :disabled="!text.trim() && files.length === 0"
      >
        {{ t('add.continue') }}
      </button>
    </form>

    <form v-else-if="draft" class="space-y-5" @submit.prevent="saveText">
      <p class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{{ t('add.checkFields') }}</p>
      <ListingForm v-model="draft" show-url />
      <div class="flex gap-3">
        <button type="button" class="btn-secondary" :disabled="!!busy" @click="step = 'input'">
          {{ t('common.back') }}
        </button>
        <button type="submit" class="btn-primary flex-1" :disabled="!!busy">
          {{ busy ?? t('add.save') }}
        </button>
      </div>
    </form>

    <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
      {{ t('common.error', { message: error }) }}
    </p>
  </div>
</template>
