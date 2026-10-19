<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatPLN, totalMonthly, type ListingFeatures } from '@at/shared'
import type { ListingDraft } from '@/lib/listings'

const draft = defineModel<ListingDraft>({ required: true })
defineProps<{ showUrl?: boolean }>()
const { t } = useI18n()

const total = computed(() =>
  totalMonthly({
    rent: draft.value.rent,
    adminFee: draft.value.adminFee,
    utilitiesEstimate: draft.value.utilitiesEstimate,
  }),
)

const money = ['rent', 'adminFee', 'utilitiesEstimate', 'deposit'] as const
const flags = ['petsAllowed', 'furnished', 'balcony', 'elevator', 'parking'] as const

function triState(key: (typeof flags)[number]): string {
  const v = draft.value.features[key]
  return v == null ? '' : v ? 'yes' : 'no'
}

function setTriState(key: (typeof flags)[number], value: string) {
  const features: ListingFeatures = { ...draft.value.features }
  if (value === '') delete features[key]
  else features[key] = value === 'yes'
  draft.value.features = features
}

function setFeature<K extends 'yearBuilt' | 'heating'>(
  key: K,
  value: ListingFeatures[K] | undefined,
) {
  const features: ListingFeatures = { ...draft.value.features }
  if (value == null || value === '') delete features[key]
  else features[key] = value
  draft.value.features = features
}

/** v-model.number leaves "" for an empty field; store null instead. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <label class="label" for="f-title">{{ t('form.title') }}</label>
      <input id="f-title" v-model="draft.title" class="input" maxlength="200" />
    </div>
    <div v-if="showUrl">
      <label class="label" for="f-url">{{ t('form.url') }}</label>
      <input
        id="f-url"
        v-model="draft.url"
        type="url"
        class="input"
        inputmode="url"
        placeholder="https://"
      />
    </div>

    <fieldset class="rounded-2xl border border-slate-200 p-3">
      <legend class="px-1 text-sm font-semibold">{{ t('form.costs') }}</legend>
      <div class="grid grid-cols-2 gap-3">
        <div v-for="key in money" :key="key">
          <label class="label" :for="`f-${key}`">{{ t(`form.${key}`) }}</label>
          <input
            :id="`f-${key}`"
            :value="draft[key]"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            class="input"
            @input="draft[key] = num(($event.target as HTMLInputElement).valueAsNumber)"
          />
        </div>
      </div>
      <p class="mt-3 text-sm text-slate-600">
        {{ t('form.totalMonthly') }}: <strong class="text-slate-900">{{ formatPLN(total) }}</strong>
      </p>
    </fieldset>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="f-area">{{ t('form.areaM2') }}</label>
        <input
          id="f-area"
          :value="draft.areaM2"
          type="number"
          min="1"
          step="0.1"
          inputmode="decimal"
          class="input"
          @input="draft.areaM2 = num(($event.target as HTMLInputElement).valueAsNumber)"
        />
      </div>
      <div>
        <label class="label" for="f-rooms">{{ t('form.rooms') }}</label>
        <input
          id="f-rooms"
          :value="draft.rooms"
          type="number"
          min="1"
          max="19"
          step="1"
          inputmode="numeric"
          class="input"
          @input="draft.rooms = num(($event.target as HTMLInputElement).valueAsNumber)"
        />
      </div>
      <div>
        <label class="label" for="f-floor">{{ t('form.floor') }}</label>
        <input
          id="f-floor"
          :value="draft.floor"
          type="number"
          step="1"
          inputmode="numeric"
          class="input"
          @input="draft.floor = num(($event.target as HTMLInputElement).valueAsNumber)"
        />
      </div>
      <div>
        <label class="label" for="f-total-floors">{{ t('form.totalFloors') }}</label>
        <input
          id="f-total-floors"
          :value="draft.totalFloors"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          class="input"
          @input="draft.totalFloors = num(($event.target as HTMLInputElement).valueAsNumber)"
        />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="f-district">{{ t('form.district') }}</label>
        <input id="f-district" v-model="draft.district" class="input" />
      </div>
      <div>
        <label class="label" for="f-available">{{ t('form.availableFrom') }}</label>
        <input id="f-available" v-model="draft.availableFrom" type="date" class="input" />
      </div>
    </div>
    <div>
      <label class="label" for="f-address">{{ t('form.address') }}</label>
      <input id="f-address" v-model="draft.address" class="input" />
    </div>

    <div>
      <label class="label" for="f-advertiser">{{ t('form.advertiserType') }}</label>
      <select id="f-advertiser" v-model="draft.advertiserType" class="input">
        <option value="unknown">{{ t('form.unknown') }}</option>
        <option value="private">{{ t('form.private') }}</option>
        <option value="agency">{{ t('form.agency') }}</option>
      </select>
    </div>

    <fieldset class="rounded-2xl border border-slate-200 p-3">
      <legend class="px-1 text-sm font-semibold">{{ t('form.features') }}</legend>
      <div class="grid grid-cols-2 gap-3">
        <div v-for="key in flags" :key="key">
          <label class="label" :for="`f-${key}`">{{ t(`features.${key}`) }}</label>
          <select
            :id="`f-${key}`"
            class="input"
            :value="triState(key)"
            @change="setTriState(key, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('form.unknown') }}</option>
            <option value="yes">{{ t('form.yes') }}</option>
            <option value="no">{{ t('form.no') }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="f-year">{{ t('features.yearBuilt') }}</label>
          <input
            id="f-year"
            :value="draft.features.yearBuilt"
            type="number"
            min="1800"
            max="2100"
            inputmode="numeric"
            class="input"
            @input="
              setFeature(
                'yearBuilt',
                num(($event.target as HTMLInputElement).valueAsNumber) ?? undefined,
              )
            "
          />
        </div>
        <div class="col-span-2">
          <label class="label" for="f-heating">{{ t('features.heating') }}</label>
          <input
            id="f-heating"
            :value="draft.features.heating"
            class="input"
            @input="setFeature('heating', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </fieldset>

    <div>
      <label class="label" for="f-description">{{ t('form.description') }}</label>
      <textarea id="f-description" v-model="draft.description" rows="6" class="input" />
    </div>
  </div>
</template>
