// The blob seam's hosted adapter (D-32318 §Storage): an R2 bucket behind
// blobs.ts's Blobs, key for key, so the kernel worker serves an app's files
// through the same three verbs the local directory answers. The bucket is
// typed structurally — the slice this adapter touches, mirroring
// @cloudflare/workers-types — so src/ carries no Cloudflare dependency. Under
// `wrangler dev` the same binding is a local simulation, which is the dev
// store; nothing chooses between them here.
import type { Blobs } from './blobs.ts'

export type R2 = {
  head(key: string): Promise<unknown | null>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>
  delete(key: string): Promise<unknown>
  list(
    opts: { prefix: string; cursor?: string },
  ): Promise<
    { objects: { key: string }[]; truncated: boolean; cursor?: string }
  >
}

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
