<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { isOtodomSearchUrl } from '@at/parsers'
import { supabase } from '@/lib/supabase'
import { ingest } from '@/lib/listings'
import {
  huntUrls,
  inHunt,
  isCurrent,
  isNew,
  relativeTime,
  sortResults,
  type SavedSearch,
  type SearchResult,
} from '@/lib/browse'
import { usePullToRefresh } from '@/lib/usePullToRefresh'
import { useAuthStore } from '@/stores/auth'
import { useListingsStore } from '@/stores/listings'
import SearchResultCard from '@/components/SearchResultCard.vue'
import SearchResultSheet from '@/components/SearchResultSheet.vue'

// Browse a saved Otodom search inside the app. Results are fetched only when
// someone pulls to refresh (or taps Refresh), never in the background.

interface RefreshResponse {
  refreshed: boolean
  total: number
  newCount: number
  totalResults: number | null
}

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const listingsStore = useListingsStore()
const huntId = computed(() => route.params.huntId as string)

const searches = ref<SavedSearch[]>([])
const selectedId = ref<string | null>(null)
const results = ref<SearchResult[]>([])
const loaded = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const showHidden = ref(false)
const adding = ref(new Set<string>())
const open = ref<SearchResult | null>(null)

// The setup / edit form.
const editing = ref<'new' | 'edit' | null>(null)
const formLabel = ref('')
const formUrl = ref('')
const saving = ref(false)

const search = computed(() => searches.value.find((s) => s.id === selectedId.value) ?? null)
const urls = computed(() => huntUrls(listingsStore.listings))
const current = computed(() =>
  search.value ? sortResults(results.value.filter((r) => isCurrent(r, search.value!))) : [],
)
const visible = computed(() => current.value.filter((r) => showHidden.value || !r.hidden_at))
const hiddenCount = computed(() => current.value.filter((r) => r.hidden_at).length)
const urlValid = computed(() => isOtodomSearchUrl(formUrl.value.trim()))

async function loadSearches() {
  const { data, error: err } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('hunt_id', huntId.value)
    .order('created_at')
  if (err) throw err
  searches.value = data
  if (!searches.value.some((s) => s.id === selectedId.value)) {
    selectedId.value = searches.value[0]?.id ?? null
  }
}

async function loadResults() {
  if (!selectedId.value) {
    results.value = []
    return
  }
  const { data, error: err } = await supabase
    .from('search_results')
    .select('*')
    .eq('search_id', selectedId.value)
  if (err) throw err
  results.value = data
}

async function load() {
  error.value = null
  try {
    await loadSearches()
    await loadResults()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loaded.value = true
  }
}

async function refresh() {
  if (!search.value) return
  const firstLoad = !search.value.last_refreshed_at
  error.value = null
  notice.value = null
  const { data, error: err } = await supabase.functions.invoke<RefreshResponse>('search-refresh', {
    body: { searchId: search.value.id },
  })
  if (err) {
    const ctx = (err as { context?: Response }).context
    const detail = ctx && (await ctx.json().catch(() => null))
    error.value = detail?.error ?? err.message
  } else if (data && !data.refreshed) {
    notice.value = t('browse.justRefreshed')
  } else if (data && firstLoad) {
    notice.value = t('browse.found', data.total)
  } else if (data) {
    notice.value = data.newCount ? t('browse.foundNew', data.newCount) : t('browse.nothingNew')
  }
  await load()
}

const listEl = useTemplateRef<HTMLElement>('listEl')
const { pull, refreshing, run, threshold } = usePullToRefresh(listEl, refresh)

async function add(result: SearchResult) {
  adding.value = new Set([...adding.value, result.external_id])
  error.value = null
  try {
    await ingest({ huntId: huntId.value, url: result.url })
    await listingsStore.fetchAll()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    const next = new Set(adding.value)
    next.delete(result.external_id)
    adding.value = next
  }
}

async function setHidden(result: SearchResult, hidden: boolean) {
  const patch = {
    hidden_at: hidden ? new Date().toISOString() : null,
    hidden_by: hidden ? auth.userId : null,
  }
  Object.assign(result, patch)
  const { error: err } = await supabase
    .from('search_results')
    .update(patch)
    .eq('search_id', result.search_id)
    .eq('external_id', result.external_id)
  if (err) error.value = err.message
}

function startNew() {
  editing.value = 'new'
  formLabel.value = searches.value.length ? '' : t('browse.defaultLabel')
  formUrl.value = ''
}

function startEdit() {
  if (!search.value) return
  editing.value = 'edit'
  formLabel.value = search.value.label
  formUrl.value = search.value.url
}

async function save() {
  saving.value = true
  error.value = null
  try {
    const fields = {
      label: formLabel.value.trim() || t('browse.defaultLabel'),
      url: formUrl.value.trim(),
    }
    // The first-time form shows without `editing` set, so anything but an edit is new.
    if (editing.value !== 'edit') {
      const { data, error: err } = await supabase
        .from('saved_searches')
        .insert({ ...fields, hunt_id: huntId.value })
        .select()
        .single()
      if (err) throw err
      selectedId.value = data.id
    } else if (search.value) {
      const { error: err } = await supabase
        .from('saved_searches')
        .update(fields)
        .eq('id', search.value.id)
      if (err) throw err
    }
    editing.value = null
    await load()
    // A new (or changed) search has nothing yet: fetch its first results.
    if (search.value && !search.value.last_refreshed_at) await run()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!search.value || !confirm(t('browse.deleteConfirm', { label: search.value.label }))) return
  const { error: err } = await supabase.from('saved_searches').delete().eq('id', search.value.id)
  if (err) error.value = err.message
  editing.value = null
  selectedId.value = null
  await load()
}

// A partner hiding a card or refreshing shows up here live.
let channel: RealtimeChannel | null = null
let reloadTimer: ReturnType<typeof setTimeout> | undefined
watch(
  huntId,
  (id) => {
    if (channel) void supabase.removeChannel(channel)
    channel = supabase
      .channel(`search_results:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'search_results', filter: `hunt_id=eq.${id}` },
        () => {
          clearTimeout(reloadTimer)
          reloadTimer = setTimeout(() => void load(), 500)
        },
      )
      .subscribe()
    void load()
  },
  { immediate: true },
)
watch(selectedId, (id, old) => {
  if (old !== undefined && id !== old) void loadResults()
})
onBeforeUnmount(() => {
  clearTimeout(reloadTimer)
  if (channel) void supabase.removeChannel(channel)
})
</script>

<template>
  <div ref="listEl" class="space-y-3" data-testid="browse">
    <!-- Pull-to-refresh indicator -->
    <div
      v-if="pull > 0 || refreshing"
      class="flex items-center justify-center overflow-hidden text-sm text-slate-500 transition-[height]"
      :style="{ height: `${refreshing ? 40 : pull}px` }"
      data-testid="pull-indicator"
    >
      <span v-if="refreshing">⟳ {{ t('browse.refreshing') }}</span>
      <span v-else>{{
        pull >= threshold * 0.5 + 20 ? t('browse.release') : t('browse.pull')
      }}</span>
    </div>

    <p v-if="!loaded" class="text-slate-500">{{ t('common.loading') }}</p>

    <!-- No saved search yet, or adding / editing one -->
    <form
      v-else-if="editing || !searches.length"
      class="card space-y-3"
      data-testid="search-form"
      @submit.prevent="save"
    >
      <h2 class="font-semibold">
        {{ editing === 'edit' ? t('browse.editTitle') : t('browse.setupTitle') }}
      </h2>
      <ol v-if="editing !== 'edit'" class="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>{{ t('browse.step1') }}</li>
        <li>{{ t('browse.step2') }}</li>
        <li>{{ t('browse.step3') }}</li>
      </ol>
      <div>
        <label class="label" for="search-label">{{ t('browse.label') }}</label>
        <input
          id="search-label"
          v-model="formLabel"
          maxlength="80"
          class="input"
          :placeholder="t('browse.defaultLabel')"
        />
      </div>
      <div>
        <label class="label" for="search-url">{{ t('browse.url') }}</label>
        <input
          id="search-url"
          v-model="formUrl"
          type="url"
          inputmode="url"
          required
          class="input"
          placeholder="https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/…"
        />
        <p v-if="formUrl && !urlValid" class="mt-1 text-xs text-rose-700">
          {{ t('browse.urlInvalid') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button v-if="editing" type="button" class="btn-secondary" @click="editing = null">
          {{ t('common.cancel') }}
        </button>
        <button v-if="editing === 'edit'" type="button" class="btn-danger" @click="remove">
          {{ t('browse.delete') }}
        </button>
        <button type="submit" class="btn-primary flex-1" :disabled="saving || !urlValid">
          {{ saving ? t('common.saving') : t('browse.save') }}
        </button>
      </div>
    </form>

    <template v-else-if="search">
      <div class="flex items-center gap-2">
        <select
          v-if="searches.length > 1"
          v-model="selectedId"
          class="input min-w-0 flex-1 py-2"
          :aria-label="t('browse.label')"
        >
          <option v-for="s in searches" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <p v-else class="min-w-0 flex-1 truncate font-semibold">{{ search.label }}</p>
        <button type="button" class="btn-secondary px-3 py-2" @click="startEdit">
          {{ t('browse.edit') }}
        </button>
        <button
          type="button"
          class="btn-secondary px-3 py-2"
          :aria-label="t('browse.addSearch')"
          @click="startNew"
        >
          ＋
        </button>
      </div>

      <div class="flex items-center gap-3 text-xs text-slate-500">
        <span class="flex-1" data-testid="search-status">
          <template v-if="search.last_refreshed_at">
            {{ t('browse.updated', { when: relativeTime(search.last_refreshed_at) }) }}
            <template v-if="search.last_total != null">
              · {{ t('browse.onOtodom', { n: search.last_total, shown: current.length }) }}
            </template>
          </template>
          <template v-else>{{ t('browse.neverRefreshed') }}</template>
        </span>
        <button
          type="button"
          class="btn-secondary px-3 py-1.5 text-xs"
          :disabled="refreshing"
          @click="run"
        >
          ⟳ {{ refreshing ? t('browse.refreshing') : t('browse.refresh') }}
        </button>
      </div>

      <p v-if="notice" class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="status">
        {{ notice }}
      </p>
      <p
        v-if="search.last_error && !refreshing"
        class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
        role="alert"
        data-testid="search-error"
      >
        {{ t('browse.lastError', { error: search.last_error }) }}
      </p>

      <p v-if="search.last_refreshed_at && !visible.length" class="card text-center text-slate-600">
        {{ t('browse.empty') }}
      </p>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SearchResultCard
          v-for="r in visible"
          :key="r.external_id"
          :result="r"
          :is-new="isNew(r, search)"
          :in-hunt="inHunt(r, urls)"
          :adding="adding.has(r.external_id)"
          @open="open = r"
          @add="add(r)"
          @hide="setHidden(r, true)"
          @unhide="setHidden(r, false)"
        />
      </div>
      <button
        v-if="hiddenCount"
        type="button"
        class="w-full py-2 text-sm text-slate-500"
        @click="showHidden = !showHidden"
      >
        {{ showHidden ? t('browse.hideHidden') : t('browse.showHidden', { n: hiddenCount }) }}
      </button>
      <p class="text-center text-xs text-slate-400">{{ t('browse.footer') }}</p>
    </template>

    <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
      {{ t('common.error', { message: error }) }}
    </p>

    <SearchResultSheet
      v-if="open"
      :result="open"
      :in-hunt="inHunt(open, urls)"
      :adding="adding.has(open.external_id)"
      @close="open = null"
      @add="add(open!)"
    />
  </div>
</template>
