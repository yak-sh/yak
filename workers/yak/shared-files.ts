// A compiler group is immutable and already named by all its emitted bytes.
// Store it in one object: hundreds of individual PUTs queued behind Workers'
// connection limit made app_deploy spend a minute uploading a megabyte.
import type { Objects, Opened } from '@yaks/blob'

type Files = Record<string, string>
let encode = (text: string) => new TextEncoder().encode(text)
let keyOf = (root: string) => `${root}.files.json`

/** Keep each complete group in one atomic write, reused across apps. */
export let keepShared = async (
  blobs: Pick<Objects, 'put' | 'has'>,
  files: Files,
) => {
  let groups = new Map<string, Files>()
  for (let [path, text] of Object.entries(files)) {
    let at = path.indexOf('/', '__packages/'.length)
    let root = path.slice(0, at)
    let group = groups.get(root) ?? {}
    group[path.slice(at + 1)] = text
    groups.set(root, group)
  }
  await Promise.all([...groups].map(async ([root, group]) => {
    let key = keyOf(root)
    if (!await blobs.has(key)) {
      await blobs.put(key, encode(JSON.stringify(group)))
    }
  }))
}

type Held = { files: Promise<Files | null>; size: number }
let held = new WeakMap<Objects, Map<string, Held>>()
let LIMIT = 16 << 20
let groupAt = (blobs: Objects, root: string) => {
  let all = held.get(blobs) ?? new Map<string, Held>()
  held.set(blobs, all)
  let hit = all.get(root)
  if (hit) return hit.files
  let entry: Held = {
    size: 0,
    files: blobs.read(keyOf(root)).then((bytes) => {
      entry.size = (bytes?.byteLength ?? 0) * 2
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as Files : null
    }),
  }
  let drop = () => all.get(root) == entry && all.delete(root)
  all.set(root, entry)
  entry.files.then((files) => {
    if (!files) return drop()
    let size = [...all.values()].reduce((n, e) => n + e.size, 0)
    for (let [key, value] of all) {
      if (size <= LIMIT) break
      all.delete(key)
      size -= value.size
    }
  }, drop)
  return entry.files
}

/** Open a group's file; older releases' individual objects still answer. */
export let openShared = async (
  blobs: Objects,
  path: string,
): Promise<Opened | null> => {
  let at = path.indexOf('/', '__packages/'.length)
  let root = path.slice(0, at)
  let group = await groupAt(blobs, root)
  if (!group) return blobs.open(path)
  let text = Object.hasOwn(group, path.slice(at + 1))
    ? group[path.slice(at + 1)]
    : null
  if (text == null) return null
  let bytes = encode(text)
  return {
    size: bytes.byteLength,
    version: root.slice('__packages/'.length),
    read: (range) =>
      Promise.resolve(
        new Response(
          range ? bytes.subarray(range.from, range.to + 1) : bytes,
        ).body!,
      ),
  }
}
