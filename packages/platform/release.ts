import { changed } from '@yaks/vocab'
import type { VocabDoc } from '@yaks/vocab'
import type { Version } from './versions.ts'

/** The files and vocabulary a page was built with. */
export type Release = { files: string; vocab: VocabDoc }
export type Reload = 'optional' | 'required'

/** Same files are the same page, including a rollback. A caller supplies the
 * marks on every release crossed; a mark may raise, never lower, the reload level. */
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

/** What an open page is told of the release it was built with: the version
 * serving now, and the reload it owes where it owes one. */
export type Status = { version: number; reload?: Reload }

/** What a host keeps of an app's versions, as a release check reads them:
 * every one, and the manifest a version's files declare. */
export type Kept = {
  versions: () => Promise<Version[]>
  vocab: (version: Version) => Promise<VocabDoc>
}

// A version's files in one order, so two with the same files say the same.
let filesOf = (v: Version) =>
  JSON.stringify(Object.entries(v.files).sort(([a], [b]) => a.localeCompare(b)))

/** The status of a page built with version `was` while `now` serves. The
 * versions are read only where the two differ, and their manifests only where
 * their files do: restored identical bytes need neither. Null where either
 * version is not kept. */
export let status = async (
  kept: Kept,
  was: number,
  now: number,
): Promise<Status | null> => {
  if (was == now) return { version: now }
  let all = await kept.versions()
  let from = all.find((v) => v.version == was)
  let to = all.find((v) => v.version == now)
  if (!from || !to) return null
  let [before, after] = [filesOf(from), filesOf(to)]
  if (before == after) return { version: now }
  let [said, says] = await Promise.all([kept.vocab(from), kept.vocab(to)])
  let reload = reloadLevel(
    { files: before, vocab: said },
    { files: after, vocab: says },
    all.filter((v) =>
      v.version > Math.min(was, now) && v.version <= Math.max(was, now)
    ),
  )
  return { version: now, ...(reload ? { reload } : {}) }
}
