// A key-addressed byte store: has/put/get/delete, and list over a key prefix,
// behind
// one interface, so a hosted backend can stand in for a local directory
// without touching a caller. dirBlobs is the local adapter — a plain
// directory of files named by key, created lazily on first write; r2Blobs
// (blobs_r2.ts) is the hosted one.
import type { Blobs } from './store/blobs.ts'
export type { Blobs } from './store/blobs.ts'

export let dirBlobs = (root: string): Blobs => {
  // Walk from the deepest directory the prefix names, then screen: a prefix
  // is a string, not a directory, the way a bucket reads it.
  let walk = async (prefix: string) => {
    let out: string[] = []
    let down = async (rel: string) => {
      for await (let e of Deno.readDir(`${root}/${rel}`)) {
        if (e.isDirectory) await down(`${rel}${e.name}/`)
        else out.push(`${rel}${e.name}`)
      }
    }
    try {
      await down(prefix.slice(0, prefix.lastIndexOf('/') + 1))
    } catch {
      // nothing under it yet
    }
    return out.filter((k) => k.startsWith(prefix)).sort()
  }
  return {
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
    read: async (key) => {
      try {
        return await Deno.readFile(`${root}/${key}`)
      } catch {
        return null
      }
    },
    get: (key) => Deno.readFile(`${root}/${key}`),
    delete: async (key) => {
      try {
        await Deno.remove(`${root}/${key}`)
      } catch {
        // already gone
      }
    },
    list: walk,
    // A file's write time is when these bytes landed, which is what a bucket
    // means by `uploaded`: the file is written once, at its own name.
    uploaded: async (prefix) => {
      let at: Record<string, number> = {}
      for (let key of await walk(prefix)) {
        let stat = await Deno.stat(`${root}/${key}`)
        at[key] = stat.mtime?.getTime() ?? 0
      }
      return at
    },
  }
}
