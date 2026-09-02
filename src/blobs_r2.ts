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
}

export let r2Blobs = (bucket: R2): Blobs => ({
  has: async (key) => (await bucket.head(key)) != null,
  put: async (key, bytes) => {
    await bucket.put(key, bytes)
  },
  get: async (key) => {
    let object = await bucket.get(key)
    if (!object) throw new Error(`no blob at ${key}`)
    return new Uint8Array(await object.arrayBuffer())
  },
})
