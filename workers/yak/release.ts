// A release names immutable bytes already in the space. A deploy writes only
// changed files into its private prefix, then writes this manifest before the
// app row selects it. Keys are relative to the space so a space rename carries
// them without rewriting the manifest.
import type { Objects } from '@yaks/blob'
import { token } from '@yaks/graph/sha256'
import {
  addressed,
  BUILT,
  type Files,
  own,
  pins,
  releaseOf,
  sha256,
} from './versions.ts'
import { encode, type Index, indexOf, META } from './release_index.ts'
import type { App, Directory } from './directory.ts'

let release = (key: string) =>
  /^([^/]+)\/\.releases\/[^/]+\/[^/]+\//.exec(key)?.[0]
let spaceOf = (prefix: string) => prefix.slice(0, prefix.indexOf('/') + 1)
let location = (space: string, key: string) =>
  key.startsWith('sha/') ? key : space + key
let complete = (index: Index | null): index is Index =>
  !!index &&
  Object.values(index).every((file) =>
    file.sha && file.key == addressed(file.sha)
  )

// A complete index names content addresses only, and a release's bytes never
// change, so neither does it: an isolate keeps the complete ones it has read,
// per store, and the next reader of that release (the edit after a deploy, a
// rollback, a page's file) asks the bucket for its bytes alone. Each read of
// an index was a round trip in front of the bytes (T-123988). An index still
// naming a release's own keys can be promoted (`prepare`), so it is read again.
let HELD = 512
let held = new WeakMap<Objects, Map<string, Promise<Index | null>>>()
let indexed = (raw: Objects, prefix: string) => {
  let kept = held.get(raw) ?? new Map<string, Promise<Index | null>>()
  held.set(raw, kept)
  let found = kept.get(prefix)
  if (found) return found
  let read = indexOf(raw, prefix)
  let drop = () => kept.get(prefix) == read && kept.delete(prefix)
  kept.set(prefix, read)
  read.then((index) => complete(index) || drop(), drop)
  for (let old of kept.keys()) {
    if (kept.size <= HELD) break
    kept.delete(old)
  }
  return read
}

// A release made before every file was pinned can be promoted in place. The
// source path stays the same, and the index changes only after every byte has
// its content address. A repeated call on a promoted release is one read.
let pinned = async (raw: Objects, source: string): Promise<Index> => {
  let root = `${source}/`
  let space = spaceOf(root)
  let prior = await indexed(raw, root)
  if (complete(prior)) return prior
  let names = prior
    ? []
    : (await raw.list(root)).map((key) => key.slice(root.length))
  let paths = prior ?? Object.fromEntries(
    (release(root) ? names : own(names)).map(
      (path) => [path, { key: (root + path).slice(space.length) }],
    ),
  )
  let pin = pins(raw, space)
  let index = Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([path, file]) => {
        let bytes = await raw.read(location(space, file.key))
        if (!bytes) throw new Error(`release has no bytes for ${path}`)
        let sha = await sha256(bytes)
        await pin.put(sha, bytes)
        return [path, { key: addressed(sha), sha }] as const
      }),
    ),
  )
  return index
}
// How many files one pass holds in hand at once: the bucket answers six calls
// at a time per request anyway, and an app's whole file set read at once could
// outgrow the isolate's memory.
let BATCH = 6

/**
 * An app still served in place from its own prefix (`<space>/<app>/`, made
 * before a release had an index) given a release like any other: each file
 * named by the SHA-256 of its bytes and pinned under it once, the index
 * written, and the app's source pointed at it. Its pages answer the same bytes
 * as before, and its next edit and deploy name shas rather than copying them.
 * The prefix's own keys stay until a later pass lets them go.
 *
 * An app with a source, a draft or a release in flight is left alone, and so
 * is one that moved while its files were read: the source only moves from
 * nothing, guarded, so a second run or a racing edit changes nothing. Answers
 * how many files the release names.
 */
export let promoted = async (
  raw: Objects,
  dir: Directory,
  prefix: string,
  app: App,
): Promise<number> => {
  if (app.source || app.draft || app.fence) return 0
  let paths = (await raw.list(prefix)).map((key) => key.slice(prefix.length))
    .filter((path) => own([path]).length || path.startsWith(BUILT))
  if (!paths.length) return 0
  let pin = pins(raw, prefix)
  let index: Index = {}
  for (let at = 0; at < paths.length; at += BATCH) {
    await Promise.all(
      paths.slice(at, at + BATCH).map(async (path) => {
        let bytes = await raw.get(prefix + path)
        let sha = await sha256(bytes)
        await pin.put(sha, bytes)
        index[path] = { key: addressed(sha), sha }
      }),
    )
  }
  let space = prefix.slice(0, prefix.indexOf('/'))
  let source = releaseOf({ slug: space }, app)
  await raw.put(source + META, encode(index))
  // An app's declarations are kept under its source's name (declaration.ts),
  // so each one it has goes under the new name before the source moves.
  let named = `${space}/.declarations/${app.eid}/`
  let declared = await raw.list(`${named}legacy/`)
  await Promise.all(declared.map(async (key) =>
    raw.put(
      `${named}${source.split('/').pop()}/${key.split('/').pop()}`,
      await raw.get(key),
    )
  ))
  await dir.stamp({
    entities: [{
      entity: { eid: app.eid },
      app: { source },
      $was: {
        app: {
          source: token(null),
          draft: token(null),
          fence: token(null),
          version: token(app.version),
        },
      },
    }],
  })
  return paths.length
}

export let prepare = async (raw: Objects, source: string): Promise<Index> => {
  let prior = await indexed(raw, `${source}/`)
  if (complete(prior)) return prior
  let index = await pinned(raw, source)
  await raw.put(source + META, encode(index))
  return index
}
// Existing releases have their bytes at their own keys. New ones point at
// immutable keys, and both shapes answer the same Objects interface.
export let releaseFiles = (blobs: Objects): Objects => {
  let cache = new Map<string, Promise<Index | null>>()
  let index = (prefix: string) => {
    let found = cache.get(prefix)
    if (!found) cache.set(prefix, found = indexed(blobs, prefix))
    return found
  }
  let physical = async (key: string) => {
    let prefix = release(key)
    if (!prefix) return key
    let held = await index(prefix)
    if (!held) return key
    let file = held[key.slice(prefix.length)]
    return file ? location(spaceOf(prefix), file.key) : null
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
      let held = await index(root)
      return held
        ? Object.keys(held).filter((path) => (root + path).startsWith(prefix))
          .map((path) => root + path).sort()
        : blobs.list(prefix)
    },
    uploaded: (prefix) => blobs.uploaded(prefix),
  }
}

// A mutable view of one private release. Only `finish` makes its index
// visible; the app row still selects it later in `record`.
export let staged = async (
  raw: Objects,
  source: string | null | undefined,
  work: string,
  prefix: string,
  sparse = false,
) => {
  let files = releaseFiles(raw)
  let root = `${prefix}/`
  let space = spaceOf(root)
  // The source's index and the draft's own keys are two reads with nothing
  // between them, so they go together.
  let [prior, changed] = await Promise.all([
    sparse && source ? pinned(raw, source) : null,
    raw.list(`${work}/`),
  ])
  let index: Index = { ...prior }
  let pin = pins(raw, space)
  let put = async (key: string, bytes: Uint8Array) => {
    let path = key.slice(root.length)
    let sha = await sha256(new Uint8Array(bytes))
    await pin.put(sha, bytes)
    index[path] = { key: addressed(sha), sha }
  }
  let present = new Set(changed.map((key) => key.slice(work.length + 1)))
  for (let path of present) {
    if (sparse && path.startsWith('.deleted/') && !present.has(path.slice(9))) {
      delete index[path.slice(9)]
    }
  }
  await Promise.all(
    changed.filter((key) =>
      !sparse || !key.slice(work.length + 1).startsWith('.deleted/')
    ).map(async (key) => {
      let path = key.slice(work.length + 1)
      await put(root + path, await raw.get(key))
    }),
  )
  let read = (key: string) =>
    key.startsWith(root)
      ? (index[key.slice(root.length)]
        ? raw.read(location(space, index[key.slice(root.length)].key))
        : Promise.resolve(null))
      : files.read(key)
  let view: Objects = {
    read,
    load: (key) =>
      key.startsWith(root)
        ? (index[key.slice(root.length)]
          ? raw.load(location(space, index[key.slice(root.length)].key))
          : Promise.resolve(null))
        : files.load(key),
    open: (key) =>
      key.startsWith(root)
        ? (index[key.slice(root.length)]
          ? raw.open(location(space, index[key.slice(root.length)].key))
          : Promise.resolve(null))
        : files.open(key),
    get: async (key) => {
      let bytes = await read(key)
      if (!bytes) throw new Error(`no object at ${key}`)
      return bytes
    },
    has: (key) =>
      key.startsWith(root)
        ? Promise.resolve(key.slice(root.length) in index)
        : files.has(key),
    put: (key, bytes) =>
      key.startsWith(root) ? put(key, bytes) : files.put(key, bytes),
    delete: async (keys) => {
      let all = [keys].flat()
      let outside = all.filter((key) => !key.startsWith(root))
      if (outside.length) await files.delete(outside)
      for (let key of all.filter((key) => key.startsWith(root))) {
        let path = key.slice(root.length)
        let held = index[path]
        delete index[path]
        if (held?.key == key.slice(space.length)) await raw.delete(key)
      }
    },
    list: (at) =>
      at.startsWith(root)
        ? Promise.resolve(
          Object.keys(index).filter((path) => (root + path).startsWith(at))
            .map((path) => root + path).sort(),
        )
        : files.list(at),
    uploaded: (at) => raw.uploaded(at),
  }
  let manifest = (): Files | null => {
    let version = Object.fromEntries(
      own(Object.keys(index)).map((path) => [path, index[path].sha]),
    ) as Files
    return Object.values(version).some((sha) => !sha) ? null : version
  }
  let finish = async (): Promise<Files> => {
    let version = manifest()
    if (!version) throw new Error('release has a file without a pinned sha')
    await raw.put(prefix + META, encode(index))
    return version
  }
  return { files: view, manifest, finish }
}
