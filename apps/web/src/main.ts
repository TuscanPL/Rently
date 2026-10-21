import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { listenForInstall } from './lib/install'
import { startUpdateChecks } from './lib/appUpdate'
import './style.css'

listenForInstall()
startUpdateChecks()

// A tapped push notification routes an already open window (see sw.ts).
navigator.serviceWorker?.addEventListener('message', (event) => {
  const data = event.data as { type?: string; url?: string } | null
  if (data?.type === 'navigate' && data.url?.startsWith(window.location.origin)) {
    window.location.href = data.url
  }
})

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')
