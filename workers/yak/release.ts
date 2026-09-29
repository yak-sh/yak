// A release names immutable bytes already in the space. A deploy writes only
// changed files into its private prefix, then writes this manifest before the
// app row selects it. Keys are relative to the space so a space rename carries
// them without rewriting the manifest.
import type { Objects } from '@yaks/blob'
import { addressed, type Files, own, pins, sha256 } from './versions.ts'
import { encode, type Index, indexOf, META } from './release_index.ts'

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

// A release made before every file was pinned can be promoted in place. The
// source path stays the same, and the index changes only after every byte has
// its content address. A repeated call on a promoted release is one read.
let pinned = async (raw: Objects, source: string): Promise<Index> => {
  let root = `${source}/`
  let space = spaceOf(root)
  let prior = await indexOf(raw, root)
  if (complete(prior)) return prior
  let paths = prior ?? Object.fromEntries(
    (await raw.list(root)).map((key) => [
      key.slice(root.length),
      { key: key.slice(space.length) },
    ]),
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
export let prepare = async (raw: Objects, source: string): Promise<Index> => {
  let prior = await indexOf(raw, `${source}/`)
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
    if (!found) cache.set(prefix, found = indexOf(blobs, prefix))
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
  let old = source ? `${source}/` : ''
  let index: Index = {}
  if (sparse && old) {
    index = { ...await pinned(raw, source!) }
  }
  let pin = pins(raw, space)
  let put = async (key: string, bytes: Uint8Array) => {
    let path = key.slice(root.length)
    let sha = await sha256(new Uint8Array(bytes))
    await pin.put(sha, bytes)
    index[path] = { key: addressed(sha), sha }
  }
  let changed = await raw.list(`${work}/`)
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
    delete: async (key) => {
      if (!key.startsWith(root)) return files.delete(key)
      let path = key.slice(root.length)
      let held = index[path]
      delete index[path]
      if (held?.key == key.slice(space.length)) await raw.delete(key)
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
