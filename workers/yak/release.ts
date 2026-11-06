// A release names immutable bytes already stored: its index maps each path to
// the bytes' content address (versions.ts `addressed`), and a deploy writes
// that index, beside what its compile made, before the app row selects it.
import type { Objects } from '@yaks/blob'
import { elapsed } from './lib/hops.ts'
import { addressed, type Files, own, sha256 } from './versions.ts'
import { decode, encode, type File, type Index, META } from './release_index.ts'

type Named = Pick<File, 'key'> & Partial<File>

let release = (key: string) =>
  /^([^/]+)\/\.releases\/[^/]+\/[^/]+\//.exec(key)?.[0]

// A release's bytes never change, so neither does its index: an isolate keeps
// the ones it has read, per store, and the next reader of that release (the
// edit after a deploy, a rollback, a page's file) asks the bucket for its
// bytes alone. Each read of an index was a round trip in front of the bytes
// (T-123988). Kept up to HELD bytes of them, the oldest let go first: an index
// carries texts (`packed`), and an app of a thousand files names them all.
let HELD = 16 * 2 ** 20
type Held = Map<string, { index: Promise<Index | null>; size: number }>
let held = new WeakMap<Objects, Held>()
let cache = (raw: Objects) => {
  let kept: Held = held.get(raw) ?? new Map()
  held.set(raw, kept)
  return kept
}
let trim = (all: Held) => {
  let total = 0
  for (let { size } of all.values()) total += size
  for (let [old, { size }] of all) {
    if (total <= HELD) break
    all.delete(old)
    total -= size
  }
}
// An index this isolate has just written is the one a read would find.
let written = async (raw: Objects, source: string, index: Index) => {
  let bytes = encode(index)
  await raw.put(source + META, bytes)
  let all = cache(raw)
  all.set(`${source}/`, {
    index: Promise.resolve(index),
    size: bytes.byteLength,
  })
  trim(all)
}
let indexAt = (raw: Objects, prefix: string) => {
  let all = cache(raw)
  let found = all.get(prefix)
  if (found) return found.index
  let entry = {
    size: 0,
    index: elapsed('index_wait', async () => {
      let bytes = await raw.read(prefix.slice(0, -1) + META)
      entry.size = bytes?.byteLength ?? 0
      return bytes && decode(bytes)
    }),
  }
  let drop = () => all.get(prefix) == entry && all.delete(prefix)
  all.set(prefix, entry)
  entry.index.then((index) => index ? trim(all) : drop(), drop)
  return entry.index
}

// What a release's index carries the text of: what a first view reads before
// any other file, its pages and the app's wrangler config (files.ts
// `configOf`), the front page first and then nearest the root, at most PACKS
// of them read and PACKED bytes kept. Only bytes that are UTF-8 are carried,
// so the text encodes back to them exactly. On 559 releases, every page and
// config of 99% of them came to under 27 KB.
let PACKED = 64 * 1024
let PACKS = 32
let FIRST = /(?:^|\/)[^/]+\.html?$|^wrangler\.jsonc?$/i
let utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
let textOf = (bytes: Uint8Array) => {
  try {
    return utf8.decode(bytes)
  } catch {
    return null
  }
}
let ranked = (path: string) =>
  [path.split('/').length, /(?:^|\/)index\.html$/.test(path) ? 0 : 1] as const

/** The index with the text of the files a first view reads, as far as
 * PACKED goes: each is read once here, so a reader of the index has it. */
export let packed = async (raw: Objects, index: Index): Promise<Index> => {
  let paths = Object.keys(index).filter((path) => FIRST.test(path))
    .sort((a, b) => {
      let [x, y] = [ranked(a), ranked(b)]
      return x[0] - y[0] || x[1] - y[1] || (a < b ? -1 : 1)
    })
    .slice(0, PACKS)
  let read = await Promise.all(paths.map((path) => raw.read(index[path].key)))
  let room = PACKED
  let out = { ...index }
  paths.forEach((path, i) => {
    let text = read[i] && read[i].byteLength <= room ? textOf(read[i]) : null
    if (text == null) return
    room -= read[i]!.byteLength
    out[path] = { ...index[path], text }
  })
  return out
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
// index: a path there names the bytes at their content address, and their
// text where the index carries it, so those bytes are never asked for.
export let releaseFiles = (blobs: Objects): Objects => {
  let index = (prefix: string) => indexAt(blobs, prefix)
  // The file a key names: the bucket's own key outside a release, and null
  // for a path its release does not hold.
  let named = async (key: string): Promise<Named | null> => {
    let prefix = release(key)
    if (!prefix) return { key }
    return (await index(prefix))?.[key.slice(prefix.length)] ?? null
  }
  let versioned = <T extends { version: string }>(file: Named, found: T) =>
    file.sha ? { ...found, version: file.sha.slice(0, 24) } : found
  let carried = (file: Named) =>
    file.text == null ? null : new TextEncoder().encode(file.text)
  let read = async (key: string) => {
    let file = await named(key)
    return file && (carried(file) ?? blobs.read(file.key))
  }
  return {
    read,
    load: async (key) => {
      let file = await named(key)
      if (!file) return null
      let bytes = carried(file)
      let found = bytes ? { bytes, version: '' } : await blobs.load(file.key)
      return found && versioned(file, found)
    },
    open: async (key) => {
      let file = await named(key)
      let object = file && await blobs.open(file.key)
      return object && versioned(file!, object)
    },
    get: async (key) => {
      let bytes = await read(key)
      if (!bytes) throw new Error(`no object at ${key}`)
      return bytes
    },
    has: async (key) => {
      let file = await named(key)
      return !!file && (file.text != null || await blobs.has(file.key))
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
 * with is a sha already stored. Only `finish` makes its index visible, with
 * the texts it carries read beside each other (`packed`), and the app row
 * selects it later still, in `record`.
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
      await packed(
        raw,
        Object.fromEntries(
          Object.entries(files).map(([path, sha]) => [
            path,
            { key: addressed(sha), sha },
          ]),
        ),
      ),
    )
    return manifest()
  }
  return { files: view, manifest, finish }
}
