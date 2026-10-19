// Builds manifest.json for each browser. Imported by vite.config.ts at build time.

export type Target = 'chrome' | 'firefox'

export interface ManifestOptions {
  target: Target
  version: string
  /** Build-time default Supabase URL; its origin becomes a host permission. */
  supabaseUrl?: string
  /** Firefox add-on id; AMO needs one that is unique to whoever signs it. */
  geckoId?: string
}

const ICONS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
}

function originPattern(url: string | undefined): string[] {
  if (!url) return []
  try {
    return [`${new URL(url).origin}/*`]
  } catch {
    return []
  }
}

/**
 * No background script: the popup does everything (read the tab, parse, call
 * ingest-listing). Supabase answers CORS for any origin, so a Supabase URL set
 * on the options page works without its own host permission.
 */
export function buildManifest(opts: ManifestOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'ApartmentTogether',
    short_name: 'AptTogether',
    description: 'Add the listing you are looking at to your shared apartment hunt.',
    version: opts.version,
    icons: ICONS,
    action: {
      default_title: 'Add to ApartmentTogether',
      default_popup: 'popup.html',
      default_icon: ICONS,
    },
    options_ui: { page: 'options.html', open_in_tab: true },
    permissions: ['activeTab', 'scripting', 'storage'],
  }
  const hosts = originPattern(opts.supabaseUrl)
  if (hosts.length) manifest.host_permissions = hosts
  if (opts.target === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: opts.geckoId || 'apartment-together@example.com',
        strict_min_version: '140.0',
        // The page you add, your email and session go to your own Supabase project.
        data_collection_permissions: {
          required: ['websiteContent', 'authenticationInfo', 'personallyIdentifyingInfo'],
        },
      },
    }
  }
  return manifest
}
