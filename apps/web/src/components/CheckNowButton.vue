<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { checkListingNow } from '@/lib/upkeep'

// "Check now" on a listing: re-reads the original ad for a new price or removal.
const props = defineProps<{ listingId: string }>()
const emit = defineEmits<{ checked: [] }>()
const { t } = useI18n()

const busy = ref(false)
const message = ref<string | null>(null)

async function check() {
  busy.value = true
  message.value = null
  try {
    const outcome = await checkListingNow(props.listingId)
    message.value = t(`upkeep.outcome.${outcome}`)
    emit('checked')
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="btn-secondary"
    :disabled="busy"
    data-testid="check-now"
    @click="check"
  >
    {{ busy ? t('upkeep.checking') : t('upkeep.checkNow') }}
  </button>
  <p v-if="message" class="w-full text-sm text-slate-600" role="status">{{ message }}</p>
</template>
