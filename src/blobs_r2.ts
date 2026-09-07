// The blob seam's hosted adapter (D-32318 §Storage): an R2 bucket behind
// blobs.ts's Blobs, key for key, so the kernel worker serves an app's files
// through the same three verbs the local directory answers. The bucket is
// typed structurally — the slice this adapter touches, mirroring
// @cloudflare/workers-types — so src/ carries no Cloudflare dependency. Under
// `wrangler dev` the same binding is a local simulation, which is the dev
// store; nothing chooses between them here.
//
// The slice itself is r2.ts, which imports nothing: a Worker that only
// DECLARES a bucket binding must be able to name the shape without loading
// this adapter. `store/blobs.ts` keeps the byte-store contract portable too.
import type { Blobs } from './store/blobs.ts'
import type { R2 } from './r2.ts'

export type { R2 }

export let r2Blobs = (bucket: R2): Blobs => ({
  has: async (key) => (await bucket.head(key)) != null,
  put: async (key, bytes) => {
    await bucket.put(key, bytes)
  },
  read: async (key) => {
    let object = await bucket.get(key)
    return object ? new Uint8Array(await object.arrayBuffer()) : null
  },
  get: async (key) => {
    let object = await bucket.get(key)
    if (!object) throw new Error(`no blob at ${key}`)
    return new Uint8Array(await object.arrayBuffer())
  },
  delete: async (key) => {
    await bucket.delete(key)
  },
  list: async (prefix) => {
    let keys: string[] = []
    let cursor: string | undefined
    do {
      let page = await bucket.list({ prefix, cursor })
      keys.push(...page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return keys.sort()
  },
})
