import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { buildManifest, type Target } from './src/manifest.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Writes manifest.json next to the pages. */
function manifest(target: Target, env: Record<string, string>): Plugin {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  return {
    name: 'at-manifest',
    generateBundle() {
      const json = buildManifest({
        target,
        // Release builds pass the tag's version (ext-v1.2.3 → 1.2.3).
        version: env.EXT_VERSION || pkg.version,
        supabaseUrl: env.VITE_SUPABASE_URL,
        geckoId: env.EXT_GECKO_ID,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(json, null, 2)}\n`,
      })
    },
  }
}

// `vite build --mode chrome|firefox`. The code is the same; only the manifest differs.
export default defineConfig(({ mode }) => {
  const target: Target = mode === 'firefox' ? 'firefox' : 'chrome'
  const env = { ...loadEnv(mode, root, ''), ...process.env } as Record<string, string>
  return {
    base: './',
    plugins: [vue(), tailwindcss(), manifest(target, env)],
    build: {
      outDir: `dist/${target}`,
      emptyOutDir: true,
      // Extension pages load from disk; no need for legacy chunks or huge-file warnings.
      target: 'es2022',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
          options: fileURLToPath(new URL('./options.html', import.meta.url)),
        },
      },
    },
  }
})
