import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
// Where a run keeps what it learned for the next: stores written whole
// through a rename, and what files held, kept by each file's status.
import { createHash } from 'node:crypto'

/** The machine's cache, where every store lies. */
export let cache: string = system.env.get('XDG_CACHE_HOME') ??
  `${system.env.get('HOME')}/.cache`

/** Where a checkout's own stores lie, by its path. Checkouts differ: one
 * store they all shared would hold whichever checkout wrote it last, and each
 * run would ask deno again of every module another checkout had changed. */
export let stores = (cwd: string = system.cwd()): string =>
  `${cache}/yak/checkouts/${
    createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  }`

// A checkout's stores, made with its first: the stores of checkouts since
// removed go then. Each names its checkout beside them.
let room = (store: string) => {
  let dir = store.slice(0, store.lastIndexOf('/'))
  if (gone(dir)) {
    io.mkdirSync(dir, { recursive: true })
    if (dir == stores()) {
      io.writeTextFileSync(`${dir}/checkout`, system.cwd())
      let all = dir.slice(0, dir.lastIndexOf('/'))
      for (let e of io.readDirSync(all)) {
        let checkout = `${all}/${e.name}/checkout`
        if (!gone(checkout) && gone(io.readTextFileSync(checkout))) {
          io.removeSync(`${all}/${e.name}`, { recursive: true })
        }
      }
    }
  }
}
let gone = (path: string) => {
  try {
    io.statSync(path)
    return false
  } catch {
    return true
  }
}

/** What a JSON store holds; nothing, when there is none. */
export let load = <T>(store: string): Record<string, T> => {
  try {
    return JSON.parse(io.readTextFileSync(store))
  } catch {
    return {}
  }
}

/** Adds `text` to the end of a store. Writes from runs at once each land
 * whole. */
export let append = (text: string, store: string): void => {
  room(store)
  io.writeTextFileSync(store, text, { append: true })
}

/** A store written whole, through a rename, so a reader never reads half; a
 * `copy` holding the same is the same file, linked. */
export let put = (text: string, store: string, copy?: string): void => {
  room(store)
  let draft = `${store}.${system.pid}`
  io.writeTextFileSync(draft, text)
  if (copy) {
    room(copy)
    let also = `${copy}.${system.pid}`
    io.linkSync(draft, also)
    io.renameSync(also, copy)
  }
  io.renameSync(draft, store)
}

/** A JSON store written whole. */
export let write = (all: unknown, store: string): void =>
  put(JSON.stringify(all), store)

// A file's status: its inode, size, and modified and changed times.
type Status = [number, number, number, number]

/**
 * What files held, by `read`, kept in `store` beside each file's status: a
 * file whose status still matches is not read again. A file changed within
 * the second before it was read could change again within its times' grain,
 * so it is not kept. `save` writes the store when what it holds changed: a
 * file read anew, or one it held and no longer does. A file not asked of
 * stays held when it lies `beyond` what the caller looked at.
 */
export let byStatus = <T>(store?: string): {
  of: (path: string, s: io.FileInfo, read: () => T) => T
  save: (beyond?: (path: string) => boolean) => void
} => {
  let before: Record<string, [...Status, T]> = store ? load(store) : {}
  let after: Record<string, [...Status, T]> = {}
  let fresh = false
  return {
    of: (path: string, s: io.FileInfo, read: () => T): T => {
      let status: Status = [s.ino, s.size, s.mtime.getTime(), s.ctime.getTime()]
      let was = before[path]
      if (was && status.every((n, i) => was[i] == n)) {
        after[path] = was
        return was[4]
      }
      let got = read()
      if (status[3] < Date.now() - 1000) {
        after[path] = [...status, got]
        fresh = true
      }
      return got
    },
    save: (beyond: (path: string) => boolean = () => false) => {
      for (let [path, was] of Object.entries(before)) {
        if (!(path in after) && beyond(path)) after[path] = was
      }
      if (
        store &&
        (fresh || Object.keys(after).length != Object.keys(before).length)
      ) write(after, store)
    },
  }
}
