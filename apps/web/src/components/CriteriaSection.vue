<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { huntCriteriaSchema, type HuntCriteria } from '@at/shared'
import { PIN_ICONS } from '@/lib/geo'
import { useHuntsStore } from '@/stores/hunts'
import { usePinsStore } from '@/stores/pins'
import { useVotesStore } from '@/stores/votes'

// Hunt settings → Criteria. The owner edits; members see the same form read-only
// (hunts can only be updated by the owner, see the hunts_update policy).
const { t } = useI18n()
const huntsStore = useHuntsStore()
const pinsStore = usePinsStore()
const votes = useVotesStore()

/** The form's state: numbers are null when empty, booleans false when off. */
interface Form {
  maxTotalMonthly: number | null
  minRooms: number | null
  minAreaM2: number | null
  allowedDistricts: string[]
  maxDistanceKm: number | null
  distancePinId: string
  privateOnly: boolean
  petsAllowed: boolean
  parking: boolean
  balcony: boolean
  availableFrom: string
  availableTo: string
  elevatorAboveFloor: number | null
  notes: string
}

const form = ref<Form>(toForm({}))
const newDistrict = ref('')
const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)
const readOnly = computed(() => !huntsStore.isOwner)

function toForm(raw: unknown): Form {
  // Field by field, so one odd stored value doesn't blank the whole form.
  const c: HuntCriteria = {}
  const stored = (raw ?? {}) as Record<string, unknown>
  for (const [key, schema] of Object.entries(huntCriteriaSchema.shape)) {
    const r = schema.safeParse(stored[key])
    if (r.success && r.data !== undefined) Object.assign(c, { [key]: r.data })
  }
  return {
    maxTotalMonthly: c.maxTotalMonthly ?? null,
    minRooms: c.minRooms ?? null,
    minAreaM2: c.minAreaM2 ?? null,
    allowedDistricts: [...(c.allowedDistricts ?? [])],
    maxDistanceKm: c.maxDistanceKm ?? null,
    distancePinId: c.distancePinId ?? '',
    privateOnly: c.privateOnly ?? false,
    petsAllowed: c.petsAllowed ?? false,
    parking: c.parking ?? false,
    balcony: c.balcony ?? false,
    availableFrom: c.availableFrom ?? '',
    availableTo: c.availableTo ?? '',
    elevatorAboveFloor: c.elevatorAboveFloor ?? null,
    notes: c.notes ?? '',
  }
}

/** Only what's set ends up in hunts.criteria. v-model.number gives '' for an empty field. */
function fromForm(f: Form): unknown {
  const num = (v: number | null | string) => (v === '' || v == null ? undefined : Number(v))
  const out: Record<string, unknown> = {
    maxTotalMonthly: num(f.maxTotalMonthly),
    minRooms: num(f.minRooms),
    minAreaM2: num(f.minAreaM2),
    allowedDistricts: f.allowedDistricts.length ? f.allowedDistricts : undefined,
    maxDistanceKm: num(f.maxDistanceKm),
    distancePinId: f.distancePinId || undefined,
    privateOnly: f.privateOnly || undefined,
    petsAllowed: f.petsAllowed || undefined,
    parking: f.parking || undefined,
    balcony: f.balcony || undefined,
    availableFrom: f.availableFrom || undefined,
    availableTo: f.availableTo || undefined,
    elevatorAboveFloor: num(f.elevatorAboveFloor),
    notes: f.notes.trim() || undefined,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

watch(
  () => huntsStore.current?.criteria,
  (c) => (form.value = toForm(c)),
  { immediate: true },
)

const pinMissing = computed(
  () =>
    !!form.value.distancePinId && !pinsStore.pins.some((p) => p.id === form.value.distancePinId),
)

function addDistrict() {
  const name = newDistrict.value.trim()
  const exists = form.value.allowedDistricts.some((d) => d.toLowerCase() === name.toLowerCase())
  if (name && !exists) form.value.allowedDistricts.push(name)
  newDistrict.value = ''
}

function removeDistrict(name: string) {
  form.value.allowedDistricts = form.value.allowedDistricts.filter((d) => d !== name)
}

async function save() {
  if (newDistrict.value.trim()) addDistrict()
  error.value = null
  saved.value = false
  const parsed = huntCriteriaSchema.safeParse(fromForm(form.value))
  if (!parsed.success) {
    error.value = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return
  }
  saving.value = true
  try {
    await huntsStore.updateHunt({ criteria: parsed.data })
    // The badges come from the summaries, which read the new criteria.
    await votes.refresh()
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="card space-y-4" data-testid="criteria">
    <div>
      <h3 class="font-semibold">{{ t('criteria.title') }}</h3>
      <p class="text-sm text-slate-600">{{ t('criteria.help') }}</p>
    </div>

    <form class="space-y-4" @submit.prevent="save">
      <fieldset :disabled="readOnly" class="space-y-4">
        <div class="space-y-3">
          <div>
            <label class="label" for="crit-max-total">{{ t('criteria.maxTotal') }}</label>
            <input
              id="crit-max-total"
              v-model.number="form.maxTotalMonthly"
              type="number"
              min="0"
              step="50"
              inputmode="numeric"
              class="input"
            />
          </div>
          <div>
            <label class="label" for="crit-min-rooms">{{ t('criteria.minRooms') }}</label>
            <input
              id="crit-min-rooms"
              v-model.number="form.minRooms"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              class="input"
            />
          </div>
          <div>
            <label class="label" for="crit-min-area">{{ t('criteria.minArea') }}</label>
            <input
              id="crit-min-area"
              v-model.number="form.minAreaM2"
              type="number"
              min="1"
              step="any"
              inputmode="decimal"
              class="input"
            />
          </div>
        </div>

        <div>
          <label class="label" for="crit-district">{{ t('criteria.districts') }}</label>
          <ul v-if="form.allowedDistricts.length" class="mb-2 flex flex-wrap gap-1.5">
            <li
              v-for="name in form.allowedDistricts"
              :key="name"
              class="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-sm text-brand-800"
              data-testid="district-chip"
            >
              {{ name }}
              <button
                v-if="!readOnly"
                type="button"
                class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-brand-100"
                :aria-label="t('criteria.removeDistrict', { name })"
                @click="removeDistrict(name)"
              >
                ✕
              </button>
            </li>
          </ul>
          <div v-if="!readOnly" class="flex gap-2">
            <input
              id="crit-district"
              v-model="newDistrict"
              class="input"
              :placeholder="t('criteria.districtPlaceholder')"
              @keydown.enter.prevent="addDistrict"
            />
            <button type="button" class="btn-secondary" @click="addDistrict">
              {{ t('criteria.addDistrict') }}
            </button>
          </div>
          <p class="mt-1 text-xs text-slate-500">{{ t('criteria.districtsHelp') }}</p>
        </div>

        <div class="space-y-3">
          <div>
            <label class="label" for="crit-distance">{{ t('criteria.maxDistance') }}</label>
            <input
              id="crit-distance"
              v-model.number="form.maxDistanceKm"
              type="number"
              min="0.1"
              step="0.1"
              inputmode="decimal"
              class="input"
            />
          </div>
          <div>
            <label class="label" for="crit-pin">{{ t('criteria.distancePin') }}</label>
            <select id="crit-pin" v-model="form.distancePinId" class="input">
              <option value="">{{ t('criteria.noPin') }}</option>
              <option v-if="pinMissing" :value="form.distancePinId">
                {{ t('criteria.pinMissing') }}
              </option>
              <option v-for="p in pinsStore.pins" :key="p.id" :value="p.id">
                {{ PIN_ICONS[p.kind] }} {{ p.label }}
              </option>
            </select>
          </div>
          <p v-if="!pinsStore.pins.length" class="text-xs text-slate-500">
            {{ t('criteria.noPins') }}
          </p>
        </div>

        <fieldset>
          <legend class="label">{{ t('criteria.mustHave') }}</legend>
          <div class="grid gap-2">
            <label
              v-for="key in ['privateOnly', 'petsAllowed', 'parking', 'balcony'] as const"
              :key="key"
              class="flex items-center gap-3 text-sm"
            >
              <input v-model="form[key]" type="checkbox" class="h-5 w-5 accent-brand-700" />
              {{ t(`criteria.${key}`) }}
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend class="label">{{ t('criteria.available') }}</legend>
          <div class="space-y-3">
            <label class="block text-xs text-slate-500">
              {{ t('criteria.availableFrom') }}
              <input v-model="form.availableFrom" type="date" class="input mt-1" />
            </label>
            <label class="block text-xs text-slate-500">
              {{ t('criteria.availableTo') }}
              <input v-model="form.availableTo" type="date" class="input mt-1" />
            </label>
          </div>
        </fieldset>

        <div>
          <label class="label" for="crit-elevator">
            {{ t('criteria.elevatorAbove') }}
          </label>
          <input
            id="crit-elevator"
            v-model.number="form.elevatorAboveFloor"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            class="input"
          />
        </div>

        <div>
          <label class="label" for="crit-notes">{{ t('criteria.notes') }}</label>
          <textarea
            id="crit-notes"
            v-model="form.notes"
            rows="2"
            maxlength="500"
            class="input"
          ></textarea>
        </div>

        <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
        <div v-if="!readOnly" class="flex items-center gap-3">
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
          <span v-if="saved" class="text-sm text-emerald-700" role="status">
            ✓ {{ t('criteria.saved') }}
          </span>
        </div>
      </fieldset>
      <p v-if="readOnly" class="text-xs text-slate-500">{{ t('settings.ownerOnly') }}</p>
    </form>
  </section>
</template>
