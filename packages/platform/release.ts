import { changed } from '@yaks/vocab'
import type { VocabDoc } from '@yaks/vocab'

/** The files and vocabulary a page was built with. */
export type Release = { files: string; vocab: VocabDoc }
export type Reload = 'optional' | 'required'

/** Same files are the same page, including a rollback. A caller supplies the
 * marks on every release crossed; a mark may raise, never lower, severity. */
export let reloadLevel = (
  was: Release,
  next: Release,
  crossed: { reload?: string | null }[] = [],
): Reload | undefined => {
  if (was.files == next.files) return undefined
  let delta = changed(was.vocab, next.vocab)
  return delta.dropped.length || delta.retyped.length ||
      crossed.some((r) => r.reload == 'required')
    ? 'required'
    : 'optional'
}
