// A release names immutable bytes already stored: its index maps each path to
// the bytes' content address (versions.ts `addressed`), and a deploy writes
// that index, beside what its compile made, before the app row selects it.
import type { Objects } from '@yaks/blob'
import { elapsed } from './lib/hops.ts'
import { addressed, type Files, own, sha256 } from './versions.ts'
import { encode, type Index, indexOf, META } from './release_index.ts'

let release = (key: string) =>
  /^([^/]+)\/\.releases\/[^/]+\/[^/]+\//.exec(key)?.[0]

// A release's bytes never change, so neither does its index: an isolate keeps
// the ones it has read, per store, and the next reader of that release (the
// edit after a deploy, a rollback, a page's file) asks the bucket for its
// bytes alone. Each read of an index was a round trip in front of the bytes
// (T-123988).
let HELD = 512
let held = new WeakMap<Objects, Map<string, Promise<Index | null>>>()
let cache = (raw: Objects) => {
  let kept = held.get(raw) ?? new Map<string, Promise<Index | null>>()
  held.set(raw, kept)
  return kept
}
// An index this isolate has just written is the one a read would find.
let written = async (raw: Objects, source: string, index: Index) => {
  await raw.put(source + META, encode(index))
  cache(raw).set(`${source}/`, Promise.resolve(index))
}
let indexAt = (raw: Objects, prefix: string) => {
  let all = cache(raw)
  let found = all.get(prefix)
  if (found) return found
  let read = elapsed('index_wait', () => indexOf(raw, prefix))
  let drop = () => all.get(prefix) == read && all.delete(prefix)
  all.set(prefix, read)
  read.then((index) => index || drop(), drop)
  for (let old of all.keys()) {
    if (all.size <= HELD) break
    all.delete(old)
  }
  return read
}

/** The files a release names, path to sha, its index read once per isolate;
 * null where it has none: a source no deploy finished, or one an erasure
 * already swept. */
export let filesIn = async (
  raw: Objects,
  source: string,
): Promise<Files | null> => {
  let index = await indexAt(raw, `${source}/`)
  return index && filesOf(index)
}

/** The files a release names, refused for one with no index. */
export let filesAt = async (raw: Objects, source: string): Promise<Files> => {
  let files = await filesIn(raw, source)
  if (!files) throw new Error(`release ${source} has no index`)
  return files
}

// The bucket's keys, with a key under a release read through that release's
// index: a path there names the bytes at their content address.
export let releaseFiles = (blobs: Objects): Objects => {
  let index = (prefix: string) => indexAt(blobs, prefix)
  let physical = async (key: string) => {
    let prefix = release(key)
    if (!prefix) return key
    let file = (await index(prefix))?.[key.slice(prefix.length)]
    return file ? file.key : null
  }
  let read = async (key: string) => {
    let at = await physical(key)
    return at ? blobs.read(at) : null
  }
  let versioned = async (key: string) => {
    let at = await physical(key)
    if (!at) return null
    let found = await blobs.load(at)
    if (!found) return null
    let prefix = release(key)
    let held = prefix ? await index(prefix) : null
    let sha = held?.[key.slice(prefix?.length ?? 0)]?.sha
    return sha ? { ...found, version: sha.slice(0, 24) } : found
  }
  return {
    read,
    load: versioned,
    open: async (key) => {
      let at = await physical(key)
      if (!at) return null
      let object = await blobs.open(at)
      if (!object) return null
      let prefix = release(key)
      let held = prefix ? await index(prefix) : null
      let sha = held?.[key.slice(prefix?.length ?? 0)]?.sha
      return sha ? { ...object, version: sha.slice(0, 24) } : object
    },
    get: async (key) => {
      let bytes = await read(key)
      if (!bytes) throw new Error(`no object at ${key}`)
      return bytes
    },
    has: async (key) => {
      let at = await physical(key)
      return at ? blobs.has(at) : false
    },
    put: (key, bytes) => blobs.put(key, bytes),
    delete: (key) => blobs.delete(key),
    list: async (prefix) => {
      let root = release(prefix)
      if (!root) return blobs.list(prefix)
      return Object.keys(await index(root) ?? {})
        .filter((path) => (root + path).startsWith(prefix))
        .map((path) => root + path).sort()
    },
    uploaded: (prefix) => blobs.uploaded(prefix),
  }
}

/** The files a release index names, path to sha. */
export let filesOf = (index: Index): Files =>
  Object.fromEntries(
    Object.entries(index).map(([path, file]) => [path, file.sha]),
  )

/**
 * One set of files read under `root`, each path resolved to the bytes its sha
 * names: a key under `root` is a path in `files`, and any other key is the
 * bucket's, read through release indexes as `releaseFiles` reads it. Nothing
 * under `root` is a key in the bucket, so a draft or a release in the making
 * is read without a listing and without a copy. Writes under `root` are the
 * caller's to say (`staged`); here they are refused.
 */
export let viewOf = (
  raw: Objects,
  root: string,
  files: Files,
  put: (path: string, bytes: Uint8Array) => Promise<void> = (path) =>
    Promise.reject(new Error(`${root}/${path} is read-only`)),
  drop: (path: string) => void = (path) => {
    throw new Error(`${root}/${path} is read-only`)
  },
): Objects => {
  let others = releaseFiles(raw)
  let at = `${root}/`
  // The sha a key names: undefined for a key outside the root, null for a
  // path the files do not hold.
  let named = (key: string) =>
    key.startsWith(at) ? files[key.slice(at.length)] ?? null : undefined
  let read = (key: string) => {
    let sha = named(key)
    return sha === undefined
      ? others.read(key)
      : sha
      ? raw.read(addressed(sha))
      : Promise.resolve(null)
  }
  return {
    read,
    load: async (key) => {
      let sha = named(key)
      if (sha === undefined) return others.load(key)
      let found = sha ? await raw.load(addressed(sha)) : null
      return found && { ...found, version: sha!.slice(0, 24) }
    },
    open: async (key) => {
      let sha = named(key)
      if (sha === undefined) return others.open(key)
      let found = sha ? await raw.open(addressed(sha)) : null
      return found && { ...found, version: sha!.slice(0, 24) }
    },
    get: async (key) => {
      let bytes = await read(key)
      if (!bytes) throw new Error(`no object at ${key}`)
      return bytes
    },
    has: (key) => {
      let sha = named(key)
      return sha === undefined ? others.has(key) : Promise.resolve(!!sha)
    },
    put: (key, bytes) =>
      key.startsWith(at)
        ? put(key.slice(at.length), bytes)
        : raw.put(key, bytes),
    delete: async (keys) => {
      let all = [keys].flat()
      let outside = all.filter((key) => !key.startsWith(at))
      if (outside.length) await raw.delete(outside)
      for (let key of all) if (key.startsWith(at)) drop(key.slice(at.length))
    },
    list: (prefix) =>
      prefix.startsWith(at) || at.startsWith(prefix)
        ? Promise.resolve(
          Object.keys(files).map((path) => at + path)
            .filter((key) => key.startsWith(prefix)).sort(),
        )
        : others.list(prefix),
    uploaded: (prefix) => raw.uploaded(prefix),
  }
}

/**
 * A release in the making: the files `from` names, read under `prefix`, with
 * what its compile writes there pinned by their bytes and added, and what it
 * drops taken out. Nothing is read or copied to make it: every file it starts
 * with is a sha already stored. Only `finish` makes its index visible, and the
 * app row selects it later still, in `record`.
 */
export let staged = (raw: Objects, from: Files, prefix: string) => {
  let files: Files = { ...from }
  // A put at the content address is the whole write: bytes already there are
  // these bytes, so one call, never a look first.
  let view = viewOf(raw, prefix, files, async (path, bytes) => {
    let sha = await sha256(new Uint8Array(bytes))
    await raw.put(addressed(sha), bytes)
    files[path] = sha
  }, (path) => void delete files[path])
  let manifest = (): Files =>
    Object.fromEntries(
      own(Object.keys(files)).map((path) => [path, files[path]]),
    )
  let finish = async (): Promise<Files> => {
    await written(
      raw,
      prefix,
      Object.fromEntries(
        Object.entries(files).map(([path, sha]) => [
          path,
          { key: addressed(sha), sha },
        ]),
      ),
    )
    return manifest()
  }
  return { files: view, manifest, finish }
}
