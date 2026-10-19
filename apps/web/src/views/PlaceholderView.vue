<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ section: 'deck' | 'list' | 'map' | 'pipeline' }>()
const { t } = useI18n()
</script>

<template>
  <div class="card mt-8 text-center text-slate-600">
    <p class="mb-2 text-lg font-semibold text-slate-900">{{ t(`nav.${section}`) }}</p>
    <p>{{ t(`placeholder.${section}`) }}</p>
  </div>
</template>
