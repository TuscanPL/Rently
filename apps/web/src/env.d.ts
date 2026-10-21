/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_GOOGLE_AUTH?: string
  /** Web Push: the VAPID public key (the private one stays in Supabase secrets). */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Short commit hash the app was built from (see vite.config.ts). */
declare const __APP_VERSION__: string
/** ISO time the app was built. */
declare const __BUILD_TIME__: string
