// A key-addressed byte store: has/put/get/delete, and list over a key prefix,
// behind
// one interface, so a hosted backend can stand in for a local directory
// without touching a caller. dirBlobs is the local adapter — a plain
// directory of files named by key, created lazily on first write; r2Blobs
// (blobs_r2.ts) is the hosted one.
export interface Blobs {
  has(key: string): Promise<boolean>
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array<ArrayBuffer>>
  // Gone, whether or not it was there: deleting twice is not an error.
  delete(key: string): Promise<void>
  // Every key under a prefix, sorted — an app's file listing.
  list(prefix: string): Promise<string[]>
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
  // A key may carry slashes (an app's file path is one), so the directories
  // it names are made, not just the root.
  put: async (key, bytes) => {
    let at = `${root}/${key}`
    await Deno.mkdir(at.slice(0, at.lastIndexOf('/')), { recursive: true })
    await Deno.writeFile(at, bytes)
  },
  get: (key) => Deno.readFile(`${root}/${key}`),
  delete: async (key) => {
    try {
      await Deno.remove(`${root}/${key}`)
    } catch {
      // already gone
    }
  },
  // Walk from the deepest directory the prefix names, then screen: a prefix
  // is a string, not a directory, the way a bucket reads it.
  list: async (prefix) => {
    let out: string[] = []
    let walk = async (rel: string) => {
      for await (let e of Deno.readDir(`${root}/${rel}`)) {
        if (e.isDirectory) await walk(`${rel}${e.name}/`)
        else out.push(`${rel}${e.name}`)
      }
    }
    try {
      await walk(prefix.slice(0, prefix.lastIndexOf('/') + 1))
    } catch {
      // nothing under it yet
    }
    return out.filter((k) => k.startsWith(prefix)).sort()
  },
})
