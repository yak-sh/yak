// A release names immutable bytes already stored: its index maps each path to
// the bytes' content address (versions.ts `addressed`), and a deploy writes
// that index, beside what its compile made, before the app row selects it. An
// older release's index may name keys of its own, relative to the space, so a
// space rename carries them without rewriting the index.
import type { Objects } from '@yaks/blob'
import { lanes } from '@yaks/fp'
import { token } from '@yaks/graph/sha256'
import {
  addressed,
  BUILT,
  type Files,
  LANES,
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
let cache = (raw: Objects) => {
  let kept = held.get(raw) ?? new Map<string, Promise<Index | null>>()
  held.set(raw, kept)
  return kept
}
// An index this isolate has just written is the one a read would find.
let written = async (raw: Objects, source: string, index: Index) => {
  await raw.put(source + META, encode(index))
  if (complete(index)) cache(raw).set(`${source}/`, Promise.resolve(index))
}
let indexed = (raw: Objects, prefix: string) => {
  let kept = cache(raw)
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
/**
 * An app still served in place from its own prefix (`<space>/<app>/`, made
 * before a release had an index) given a release like any other: each file
 * named by the SHA-256 of its bytes and pinned under it once, the index
 * written, and the app's source pointed at it. Its pages answer the same bytes
 * as before, and its next edit and deploy name shas rather than copying them.
 * The prefix's own keys stay until a later pass lets them go. A draft the app
 * had open was its edits over those same files, so it stays open over the
 * release.
 *
 * An app with a source or a release in flight is left alone. The source only
 * moves from nothing, guarded, so a second run changes nothing, and one that
 * crossed an edit or a deploy is refused as stale. Answers the app as it now
 * stands.
 */
export let promoted = async (
  raw: Objects,
  dir: Directory,
  prefix: string,
  app: App,
): Promise<App> => {
  if (app.source || app.fence) return app
  let paths = (await raw.list(prefix)).map((key) => key.slice(prefix.length))
    .filter((path) => own([path]).length || path.startsWith(BUILT))
  if (!paths.length) return app
  let pin = pins(raw, prefix)
  let index: Index = {}
  // A lane holds one file at a time, so the whole set is never in hand at
  // once to outgrow the isolate's memory.
  await lanes(LANES)(paths, async (path) => {
    let bytes = await raw.get(prefix + path)
    let sha = await sha256(bytes)
    await pin.put(sha, bytes)
    index[path] = { key: addressed(sha), sha }
  })
  let space = prefix.slice(0, prefix.indexOf('/'))
  let source = releaseOf({ slug: space }, app)
  await written(raw, source, index)
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
          draft: token(app.draft ?? null),
          fence: token(null),
          version: token(app.version),
        },
      },
    }],
  })
  return { ...app, source }
}

export let prepare = async (raw: Objects, source: string): Promise<Index> => {
  let prior = await indexed(raw, `${source}/`)
  if (complete(prior)) return prior
  let index = await pinned(raw, source)
  await written(raw, source, index)
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

/** The files a release index names, path to sha. A complete index (every
 * index written since D-34942, and every one `prepare` has promoted) names a
 * sha for every path. */
export let filesOf = (index: Index): Files =>
  Object.fromEntries(
    Object.entries(index).flatMap(([path, file]) =>
      file.sha ? [[path, file.sha]] : []
    ),
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
