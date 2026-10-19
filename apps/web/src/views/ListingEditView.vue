<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/lib/supabase'
import { draftFromListing, draftToUpdate, type Listing, type ListingDraft } from '@/lib/listings'
import { useAuthStore } from '@/stores/auth'
import ListingForm from '@/components/ListingForm.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const listingId = route.params.listingId as string
const huntId = route.params.huntId as string

const original = ref<Listing | null>(null)
const draft = ref<ListingDraft | null>(null)
const saving = ref(false)
const error = ref<string | null>(null)

void supabase
  .from('listings')
  .select('*')
  .eq('id', listingId)
  .single()
  .then(({ data, error: err }) => {
    if (err) error.value = err.message
    original.value = data
    draft.value = data && draftFromListing(data)
  })

async function save() {
  if (!draft.value || !original.value) return
  saving.value = true
  error.value = null
  const update = draftToUpdate(draft.value)
  const before = original.value as Record<string, unknown>
  const changed = Object.entries(update)
    .filter(([k, v]) => k !== 'needs_details' && JSON.stringify(v) !== JSON.stringify(before[k]))
    .map(([k]) => k)

  const { error: err } = await supabase.from('listings').update(update).eq('id', listingId)
  if (err) {
    error.value = err.message
    saving.value = false
    return
  }
  if (changed.length) {
    const writes: PromiseLike<unknown>[] = [
      supabase.from('listing_events').insert({
        listing_id: listingId,
        user_id: auth.userId!,
        type: 'edited',
        payload: { fields: changed },
      }),
    ]
    if (changed.includes('rent') || changed.includes('admin_fee')) {
      writes.push(
        supabase
          .from('listing_price_history')
          .insert({ listing_id: listingId, rent: update.rent, admin_fee: update.admin_fee }),
      )
    }
    await Promise.all(writes)
  }
  await router.replace({ name: 'listing', params: { huntId, listingId } })
}
</script>

<template>
  <div class="space-y-5">
    <h2 class="text-xl font-bold">{{ t('listing.editTitle') }}</h2>
    <form v-if="draft" class="space-y-5" @submit.prevent="save">
      <ListingForm v-model="draft" />
      <div class="sticky bottom-20 flex gap-3 md:bottom-4">
        <button type="button" class="btn-secondary" @click="router.back()">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary flex-1" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
    <p v-else-if="!error" class="text-slate-500">{{ t('common.loading') }}</p>
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </div>
</template>
