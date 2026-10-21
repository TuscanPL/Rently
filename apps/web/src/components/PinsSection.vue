<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PIN_KINDS, type LatLng, type PinKind } from '@at/shared'
import { PIN_ICONS, type Pin } from '@/lib/geo'
import { arrivalLabel } from '@/lib/transit'
import { useHuntsStore } from '@/stores/hunts'
import { usePinsStore } from '@/stores/pins'
import LocationPicker from './LocationPicker.vue'

// Hunt settings → Pins: places the hunt measures listings against.
const { t } = useI18n()
const huntsStore = useHuntsStore()
const pinsStore = usePinsStore()

/** null: no editor open; 'new': adding; otherwise the pin being edited. */
const editing = ref<'new' | string | null>(null)
const label = ref('')
const kind = ref<PinKind>('work')
const location = ref<LatLng | null>(null)
const arriveWeekday = ref(2)
const arriveTime = ref('09:00')
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const saving = ref(false)
const error = ref<string | null>(null)

function startAdd() {
  editing.value = 'new'
  label.value = ''
  kind.value = 'work'
  location.value = null
  arriveWeekday.value = 2
  arriveTime.value = '09:00'
  error.value = null
}

function startEdit(pin: Pin) {
  editing.value = pin.id
  label.value = pin.label
  kind.value = pin.kind
  location.value = { lat: pin.lat, lng: pin.lng }
  arriveWeekday.value = pin.arrive_weekday
  arriveTime.value = pin.arrive_time.slice(0, 5)
  error.value = null
}

async function save() {
  if (!location.value) {
    error.value = t('pins.needLocation')
    return
  }
  saving.value = true
  error.value = null
  const input = {
    label: label.value.trim(),
    kind: kind.value,
    ...location.value,
    arrive_weekday: arriveWeekday.value,
    arrive_time: arriveTime.value,
  }
  try {
    if (editing.value === 'new') await pinsStore.add(input)
    else await pinsStore.update(editing.value!, input)
    editing.value = null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove(pin: Pin) {
  if (!confirm(t('pins.deleteConfirm', { label: pin.label }))) return
  try {
    await pinsStore.remove(pin.id)
    if (editing.value === pin.id) editing.value = null
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <section class="card space-y-3" data-testid="pins">
    <h3 class="font-semibold">{{ t('pins.title') }}</h3>
    <p class="text-sm text-slate-600">{{ t('pins.help') }}</p>

    <ul v-if="pinsStore.pins.length" class="divide-y divide-slate-100">
      <li v-for="pin in pinsStore.pins" :key="pin.id" class="flex items-center gap-3 py-2">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg"
          aria-hidden="true"
          >{{ PIN_ICONS[pin.kind] }}</span
        >
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ pin.label }}</span>
          <span class="text-xs text-slate-500">
            {{ t(`pins.kind.${pin.kind}`) }} ·
            {{ t('transit.arriveBy', { when: arrivalLabel(pin.arrive_weekday, pin.arrive_time) }) }}
          </span>
        </span>
        <button type="button" class="text-sm text-brand-700" @click="startEdit(pin)">
          {{ t('pins.edit') }}
        </button>
        <button type="button" class="text-sm text-rose-700" @click="remove(pin)">
          {{ t('pins.delete') }}
        </button>
      </li>
    </ul>
    <p v-else-if="editing !== 'new'" class="text-sm text-slate-500">{{ t('pins.empty') }}</p>

    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    <form
      v-if="editing"
      class="space-y-3 rounded-xl bg-slate-50 p-3"
      data-testid="pin-form"
      @submit.prevent="save"
    >
      <p class="text-sm font-semibold">
        {{ editing === 'new' ? t('pins.addTitle') : t('pins.editTitle') }}
      </p>
      <div class="space-y-3">
        <div>
          <label class="label" for="pin-label">{{ t('pins.label') }}</label>
          <input
            id="pin-label"
            v-model="label"
            required
            maxlength="80"
            class="input"
            :placeholder="t('pins.labelPlaceholder')"
          />
        </div>
        <div>
          <label class="label" for="pin-kind">{{ t('pins.kindLabel') }}</label>
          <select id="pin-kind" v-model="kind" class="input">
            <option v-for="k in PIN_KINDS" :key="k" :value="k">
              {{ PIN_ICONS[k] }} {{ t(`pins.kind.${k}`) }}
            </option>
          </select>
        </div>
      </div>
      <fieldset class="space-y-3">
        <legend class="label">{{ t('transit.arriveLegend') }}</legend>
        <p class="-mt-1 text-xs text-slate-500">{{ t('transit.arriveHelp') }}</p>
        <div>
          <label class="label" for="pin-weekday">{{ t('transit.weekday') }}</label>
          <select id="pin-weekday" v-model.number="arriveWeekday" class="input">
            <option v-for="day in WEEKDAYS" :key="day" :value="day">
              {{ arrivalLabel(day, '00:00').split(' ')[0] }}
            </option>
          </select>
        </div>
        <div>
          <label class="label" for="pin-time">{{ t('transit.time') }}</label>
          <input id="pin-time" v-model="arriveTime" type="time" required class="input" />
        </div>
      </fieldset>
      <LocationPicker v-model="location" :city="huntsStore.current?.city" />
      <div class="flex gap-3">
        <button type="button" class="btn-secondary" @click="editing = null">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary flex-1" :disabled="saving || !location">
          {{ saving ? t('common.saving') : t('pins.save') }}
        </button>
      </div>
    </form>
    <button v-else type="button" class="btn-primary w-full" @click="startAdd">
      {{ t('pins.add') }}
    </button>
  </section>
</template>
