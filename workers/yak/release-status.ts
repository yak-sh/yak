// Immutable release pairs are shared; the app row in the gateway stays fresh.
import { type Reload, reloadLevel } from '@yaks/platform'
import type { VocabDoc } from '@yaks/vocab'
import { type App, type Directory, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { r2Objects } from './lib/objects.ts'
import { pins, type Version } from './versions.ts'
import { appDoc } from './vocab.ts'

let held = new WeakMap<Env, Map<string, Promise<Reload | undefined>>>()
let filesOf = (v: Version) =>
  JSON.stringify(Object.entries(v.files).sort(([a], [b]) => a.localeCompare(b)))

export let releaseStatus = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  version: number,
) => {
  let now = app.version ?? 0
  if (version >= now) return { version: now }
  let cache = held.get(env)
  if (!cache) held.set(env, cache = new Map())
  let key = `${app.eid}:${version}:${now}`
  let found = cache.get(key)
  if (!found) {
    found = (async () => {
      let all = await dir.deploys(app)
      let was = all.find((v) => v.version == version)
      let next = all.find((v) => v.version == now)
      if (!was || !next) throw new Error('no_such_release')
      let oldFiles = filesOf(was)
      let newFiles = filesOf(next)
      // Restored identical bytes need neither vocabulary reads nor a notice.
      if (oldFiles == newFiles) return undefined
      let blobs = pins(r2Objects(env.BLOBS), `${space.slug}/${app.slug}/`)
      let vocab = async (v: Version): Promise<VocabDoc> => {
        let file = ['vocab.yml', 'vocab.json'].find((p) => v.files[p])
        if (!file) return {}
        let bytes = await blobs.get(v.files[file])
        if (!bytes) throw new Error(`release has no bytes for ${file}`)
        return appDoc(new TextDecoder().decode(bytes), file)
      }
      let [oldVocab, newVocab] = await Promise.all([vocab(was), vocab(next)])
      return reloadLevel(
        { files: oldFiles, vocab: oldVocab },
        { files: newFiles, vocab: newVocab },
        all.filter((v) =>
          v.version > version && v.version <= now
        ) as (Version & { reload?: string | null })[],
      )
    })()
    if (cache.size >= 1024) cache.delete(cache.keys().next().value!)
    cache.set(key, found)
    found.catch(() => cache!.delete(key))
  }
  let reload = await found
  return { version: now, ...(reload ? { reload } : {}) }
}
