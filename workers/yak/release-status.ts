// The release check (`/api/release`) as yaks.app keeps an app's versions:
// read from the directory's deploy rows and the bucket's pinned bytes, by
// @yaks/platform's `status`. Immutable release pairs are shared across an
// isolate's requests; the app row in the gateway stays fresh.
import { type Status, status } from '@yaks/platform'
import { pins, type Version } from '@yaks/platform/versions'
import { VOCABS } from '@yaks/platform/manifest'
import { type App, type Directory } from './directory.ts'
import type { Env } from './env.ts'
import { r2Objects } from './lib/objects.ts'
import { sharing } from './lib/shared.ts'
import { appDoc } from './vocab.ts'

let held = new WeakMap<Env, Map<string, Status>>()

// What a pair with no such version throws, so it is not kept: a version a
// page names may be one the directory has not answered with yet.
let NONE = Symbol('no such release')

/** What a page built with `version` is told of the app's live or offered
 * release. An offered release includes its history through publication. */
export let releaseStatus = async (
  env: Env,
  dir: Directory,
  app: App,
  version: number,
  publishedOnly: boolean,
): Promise<Status | null> => {
  let through = publishedOnly ? app.published?.version : undefined
  if (publishedOnly && (through == null || version > through)) return null
  let now = through ?? app.version ?? 0
  let kept = {
    versions: () => dir.deploys(app, through),
    vocab: async (v: Version) => {
      let file = VOCABS.find((p) => v.files[p])
      if (!file) return {}
      let bytes = await pins(r2Objects(env.BLOBS)).get(v.files[file])
      if (!bytes) throw new Error(`release has no bytes for ${file}`)
      return appDoc(new TextDecoder().decode(bytes), file)
    },
  }
  // A page on the serving release reads nothing, so nothing is kept for it.
  if (version == now) return status(kept, version, now)
  let cache = held.get(env)
  if (!cache) held.set(env, cache = new Map())
  return await sharing(cache, `${app.eid}:${version}:${now}`, async () => {
    let said = await status(kept, version, now)
    if (!said) throw NONE
    return said
  }, 1024).catch((e) => e === NONE ? null : Promise.reject(e))
}
