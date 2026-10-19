import { createI18n } from 'vue-i18n'
import en from './locales/en.json'

// English first; add pl.json here when the Polish translation lands.
export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
  datetimeFormats: {
    en: {
      short: { day: 'numeric', month: 'short', year: 'numeric' },
      long: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    },
  },
})
