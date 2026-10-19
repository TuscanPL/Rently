<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ListingStatus } from '@at/shared'
import { STATUS_CLASSES } from '@/lib/pipeline'

defineProps<{ status: ListingStatus }>()
const { t } = useI18n()
</script>

<template>
  <span
    class="rounded-full px-2 py-0.5 text-xs font-medium"
    :class="STATUS_CLASSES[status]"
    data-testid="status-pill"
  >
    {{ t(`pipeline.status.${status}`) }}
  </span>
</template>
