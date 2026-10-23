<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { OtodomSearchParams } from '@at/parsers'
import type { HuntCriteria, ParsedListing } from '@at/shared'
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
import { useHuntsStore } from '@/stores/hunts'
import SearchResultCard from '@/components/SearchResultCard.vue'
import SearchResultSheet from '@/components/SearchResultSheet.vue'
import SearchForm from '@/components/SearchForm.vue'

// Browse a saved Otodom search inside the app, like a feed: pull to refresh
// reads page 1 (newest ads), scrolling to the end reads the next page. Nothing
// is fetched in the background.

interface RefreshResponse {
  refreshed: boolean
  total: number
  newCount: number
  page: number
  loadedPages: number
  totalPages: number | null
  totalResults: number | null
}

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const listingsStore = useListingsStore()
const huntsStore = useHuntsStore()
const huntId = computed(() => route.params.huntId as string)

// Typed as Ref: the jsonb `params` column makes ref<T>() infer too deeply.
const searches: Ref<SavedSearch[]> = ref([])
const selectedId = ref<string | null>(null)
const results: Ref<SearchResult[]> = ref([])
const loaded = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const showHidden = ref(false)
const adding = ref(new Set<string>())
const open: Ref<SearchResult | null> = ref(null)

// The setup / edit form.
const editing = ref<'new' | 'edit' | null>(null)
const saving = ref(false)
const loadingMore = ref(false)

const search = computed(() => searches.value.find((s) => s.id === selectedId.value) ?? null)
const urls = computed(() => huntUrls(listingsStore.listings))
const current = computed(() =>
  search.value ? sortResults(results.value.filter((r) => isCurrent(r, search.value!))) : [],
)
const visible = computed(() => current.value.filter((r) => showHidden.value || !r.hidden_at))
const hiddenCount = computed(() => current.value.filter((r) => r.hidden_at).length)
const canLoadMore = computed(
  () =>
    !!search.value?.last_refreshed_at &&
    search.value.total_pages != null &&
    search.value.loaded_pages < search.value.total_pages,
)
const criteria = computed<HuntCriteria>(() => {
  // Read through `unknown`: the jsonb column's type is too deep to narrow directly.
  const hunt = huntsStore.current as { criteria?: unknown; city?: string } | null
  return (hunt?.criteria ?? {}) as HuntCriteria
})
const huntCity = computed(() => (huntsStore.current as { city?: string } | null)?.city ?? null)

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

async function invokeRefresh(body: { searchId: string; page?: number }) {
  const { data, error: err } = await supabase.functions.invoke<RefreshResponse>('search-refresh', {
    body,
  })
  if (err) {
    const ctx = (err as { context?: Response }).context
    const detail = ctx && (await ctx.json().catch(() => null))
    error.value = detail?.error ?? err.message
    return null
  }
  return data
}

async function refresh() {
  if (!search.value) return
  const firstLoad = !search.value.last_refreshed_at
  error.value = null
  notice.value = null
  const data = await invokeRefresh({ searchId: search.value.id })
  if (data && !data.refreshed) {
    notice.value = t('browse.justRefreshed')
  } else if (data && firstLoad) {
    notice.value = t('browse.found', data.total)
  } else if (data) {
    notice.value = data.newCount ? t('browse.foundNew', data.newCount) : t('browse.nothingNew')
  }
  await load()
}

/** The next result page; called when the end of the list scrolls into view. */
async function loadMore() {
  if (!search.value || !canLoadMore.value || loadingMore.value || refreshing.value) return
  loadingMore.value = true
  error.value = null
  try {
    await invokeRefresh({ searchId: search.value.id, page: search.value.loaded_pages + 1 })
    await load()
  } finally {
    loadingMore.value = false
  }
}

const listEl = useTemplateRef<HTMLElement>('listEl')
const { pull, refreshing, run, threshold } = usePullToRefresh(listEl, refresh)

async function add(result: SearchResult, liked = false) {
  adding.value = new Set([...adding.value, result.external_id])
  error.value = null
  try {
    // The full ad read when the card was opened saves fetching it again.
    await ingest(
      result.detail
        ? { huntId: huntId.value, url: result.url, parsed: result.detail, via: 'browse', liked }
        : { huntId: huntId.value, url: result.url, liked },
    )
    await listingsStore.fetchAll()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    const next = new Set(adding.value)
    next.delete(result.external_id)
    adding.value = next
  }
}

function setDetail(result: SearchResult, detail: ParsedListing) {
  const patched = { ...result, detail: detail as never }
  results.value = results.value.map((r) => (r.external_id === result.external_id ? patched : r))
  if (open.value?.external_id === result.external_id) open.value = patched
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

async function save(fields: { label: string; url: string; params: OtodomSearchParams | null }) {
  saving.value = true
  error.value = null
  try {
    // The first-time form shows without `editing` set, so anything but an edit is new.
    if (editing.value !== 'edit') {
      const { data, error: err } = await supabase
        .from('saved_searches')
        .insert({ ...fields, params: fields.params as never, hunt_id: huntId.value })
        .select()
        .single()
      if (err) throw err
      selectedId.value = data.id
    } else if (search.value) {
      const { error: err } = await supabase
        .from('saved_searches')
        .update({ ...fields, params: fields.params as never })
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
// Reaching the end of the list loads the next page, once the user has actually
// scrolled: a short list whose end is already on screen doesn't fetch by itself.
const endEl = useTemplateRef<HTMLElement>('endEl')
let observer: IntersectionObserver | undefined
let scrolled = false
const onScroll = () => {
  if (window.scrollY > 0) scrolled = true
}
window.addEventListener('scroll', onScroll, { passive: true })
watch(endEl, (el) => {
  observer?.disconnect()
  if (!el) return
  observer = new IntersectionObserver(
    (entries) => {
      if (scrolled && entries.some((e) => e.isIntersecting)) void loadMore()
    },
    { rootMargin: '400px' },
  )
  observer.observe(el)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  observer?.disconnect()
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
    <SearchForm
      v-else-if="editing || !searches.length"
      :key="editing === 'edit' ? search?.id : 'new'"
      :search="editing === 'edit' ? search : null"
      :hunt-city="huntCity"
      :criteria="criteria"
      :saving="saving"
      :cancellable="searches.length > 0"
      @save="save"
      @cancel="editing = null"
      @remove="remove"
    />

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
        <button type="button" class="btn-secondary px-3 py-2" @click="editing = 'edit'">
          {{ t('browse.edit') }}
        </button>
        <button
          type="button"
          class="btn-secondary px-3 py-2"
          :aria-label="t('browse.addSearch')"
          @click="editing = 'new'"
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
      <div v-if="canLoadMore" ref="endEl" class="text-center">
        <button
          type="button"
          class="btn-secondary w-full"
          :disabled="loadingMore"
          data-testid="load-more"
          @click="loadMore"
        >
          {{
            loadingMore
              ? t('browse.loadingMore')
              : t('browse.loadMore', { page: search.loaded_pages + 1, total: search.total_pages })
          }}
        </button>
      </div>
      <p v-else-if="search.last_refreshed_at" class="text-center text-xs text-slate-400">
        {{ t('browse.end') }}
      </p>
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
      @add="(liked) => add(open!, liked)"
      @detail="(detail) => setDetail(open!, detail)"
    />
  </div>
</template>
