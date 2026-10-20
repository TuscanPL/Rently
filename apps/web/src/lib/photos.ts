import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'

const BUCKET = 'listing-photos'
const cache = new Map<string, Promise<string | null>>()
let pending: { path: string; resolve: (url: string | null) => void }[] = []

/** Signed URL for a private Storage object. Requests in the same tick are batched. */
export function signedUrl(path: string): Promise<string | null> {
  let p = cache.get(path)
  if (!p) {
    p = new Promise((resolve) => {
      pending.push({ path, resolve })
      if (pending.length === 1) queueMicrotask(flush)
    })
    cache.set(path, p)
  }
  return p
}

async function flush() {
  const batch = pending
  pending = []
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(
    batch.map((b) => b.path),
    60 * 60 * 6,
  )
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]))
  for (const b of batch) {
    const url = byPath.get(b.path) ?? null
    if (!url) cache.delete(b.path)
    b.resolve(url)
  }
}

/** Compresses in the browser (max 1280px WebP) and uploads under the hunt's folder. */
export async function uploadPhoto(huntId: string, file: File): Promise<string> {
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 1280,
    fileType: 'image/webp',
    initialQuality: 0.8,
    maxSizeMB: 0.6,
    useWebWorker: true,
  })
  const path = `${huntId}/uploads/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, { contentType: 'image/webp' })
  if (error) throw error
  return path
}

/** A photo picked in a form, with a blob: preview URL, not uploaded yet. */
export interface PickedPhoto {
  file: File
  preview: string
}
