// A key-addressed byte store: has/put/get behind one interface, so a hosted
// backend (R2, on Cloudflare) can stand in for a local directory without
// touching a caller. dirBlobs is the local adapter — the only one today —
// a plain directory of files named by key, created lazily on first write.
export interface Blobs {
  has(key: string): Promise<boolean>
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array<ArrayBuffer>>
}

export let dirBlobs = (root: string): Blobs => ({
  has: async (key) => {
    try {
      await Deno.stat(`${root}/${key}`)
      return true
    } catch {
      return false
    }
  },
  put: async (key, bytes) => {
    await Deno.mkdir(root, { recursive: true })
    await Deno.writeFile(`${root}/${key}`, bytes)
  },
  get: (key) => Deno.readFile(`${root}/${key}`),
})
