import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // GitHub Pages serves the app at /<repo>/; forks and custom domains override VITE_BASE.
  const rawBase = env.VITE_BASE || '/'
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

  return {
    base,
    plugins: [
      vue(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // Our own worker (src/sw.ts): workbox precaching and the index.html
        // navigation fallback, plus the Web Push `push` / `notificationclick` handlers.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: base,
          name: 'ApartmentTogether',
          short_name: 'AptTogether',
          description: 'Search for a rental apartment together.',
          theme_color: '#0f766e',
          background_color: '#f8fafc',
          display: 'standalone',
          scope: base,
          start_url: base,
          // Relative to the manifest, which is served at <base>manifest.webmanifest.
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          // GET keeps sharing working on static hosting with no service worker handler.
          // The browser puts the params in the real query string (?url=…#/add);
          // lib/share.ts moves them into the hash route's query before routing.
          share_target: {
            action: `${base}#/add`,
            method: 'GET',
            params: { title: 'title', text: 'text', url: 'url' },
          },
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173 },
    // Leaflet is only imported by lazy routes; pre-bundling it stops the dev server
    // from discovering it mid-session and reloading the page.
    optimizeDeps: { include: ['leaflet'] },
  }
})
