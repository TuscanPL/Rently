import type { CommentKind, ViewingRatings } from '@at/shared'
import { supabase, type Tables } from './supabase'
import { uploadPhoto, type PickedPhoto } from './photos'

export type Comment = Tables<'comments'>

export interface NewComment {
  huntId: string
  listingId: string
  body: string
  photos: PickedPhoto[]
  kind?: CommentKind
  ratings?: ViewingRatings | null
  /** Progress while photos upload: (done, total). */
  onUpload?: (n: number, total: number) => void
}

/** Uploads the photos, then posts the comment (or viewing note). A trigger logs `commented`. */
export async function postComment(c: NewComment): Promise<Comment> {
  const photoPaths: string[] = []
  for (const [i, p] of c.photos.entries()) {
    c.onUpload?.(i + 1, c.photos.length)
    photoPaths.push(await uploadPhoto(c.huntId, p.file))
  }
  const { data, error } = await supabase
    .from('comments')
    .insert({
      listing_id: c.listingId,
      body: c.body.trim(),
      photo_paths: photoPaths,
      kind: c.kind ?? 'comment',
      ratings: c.ratings ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export function viewingRatings(c: Comment): ViewingRatings {
  return (c.ratings ?? {}) as ViewingRatings
}
