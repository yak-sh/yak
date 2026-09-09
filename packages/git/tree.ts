// A directory, as git writes one down: `<mode> <name>\0<raw id>` per child,
// concatenated in git's order — and a flat `path → bytes` manifest folded into
// the nest of those directories a commit needs.
//
// Two details are the whole of the format, and both are places a hand-written
// tree usually goes wrong:
//
// - **The mode has no leading zero.** A directory is `40000` in the body, even
//   though `git ls-tree` prints `040000`. One byte, and the tree is a
//   different object.
// - **A directory sorts as though its name ended in `/`.** So `a.txt` comes
//   before the directory `a`, because `.` (0x2e) is below `/` (0x2f) — the
//   reverse of a plain name sort. Names are compared as UTF-8 BYTES, which is
//   what git compares; JavaScript's own string order is UTF-16 and disagrees
//   above the BMP.
//
// The order is not a choice a caller gets to make: {@link treeBody} sorts what
// it is handed, so an id is a function of the entries alone.

import { bin, concat } from './oid.ts'

/** A regular file's mode, as a tree body spells it. */
export let FILE = '100644'

/** A directory's mode — no leading zero, unlike `git ls-tree`'s printing. */
export let DIR = '40000'

/** One child of a tree: what it is called here, what it is, and its id. The id
 * is whichever name is being written — a SHA-256 body names its children by
 * their `oid256` (see ./oid.ts). */
export type Entry = { name: string; mode: string; oid: string }

/** A version's files, the shape a yaks.app deploy manifest already has: the
 * path the app serves at, and the SHA-256 of the bytes it serves. */
export type Files = Record<string, string>

/** A directory of a manifest: files by name, and the directories under it. */
export type Dir = { files: Map<string, string>; dirs: Map<string, Dir> }

let utf8 = new TextEncoder()

// Git's order, over UTF-8 bytes, with a directory wearing the `/` it is about
// to be entered through.
let key = (e: Entry): Uint8Array =>
  utf8.encode(e.mode == DIR ? e.name + '/' : e.name)

let below = (a: Uint8Array, b: Uint8Array): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] != b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** The entries in the order a tree stores them. */
export let sorted = (entries: Entry[]): Entry[] =>
  [...entries].sort((a, b) => below(key(a), key(b)))

/** A tree object's body: every child, in git's order. */
export let treeBody = (entries: Entry[]): Uint8Array<ArrayBuffer> =>
  concat(
    sorted(entries).flatMap((
      e,
    ) => [utf8.encode(`${e.mode} ${e.name}\0`), bin(e.oid)]),
  )

let dir = (): Dir => ({ files: new Map(), dirs: new Map() })

// A name cannot be a file here and a directory there: the tree would hold it
// twice, and no reader could say which one it meant.
let both = (path: string): Error =>
  new Error(`git: \`${path}\` is both a file and a directory`)

/**
 * A flat manifest folded into directories: `{'lib/a.js': sha}` becomes a root
 * holding one directory `lib` holding one file `a.js`.
 *
 * Leading and doubled slashes are nothing, `.` is here, and `..` is refused —
 * a manifest that names its way out of its own root has no tree to become.
 */
export let nest = (files: Files): Dir => {
  let root = dir()
  for (let [path, sha] of Object.entries(files)) {
    let parts = path.split('/').filter((p) => p && p != '.')
    if (parts.some((p) => p == '..')) {
      throw new Error(`git: \`${path}\` leaves its own root`)
    }
    let name = parts.pop()
    if (!name) continue
    let at = root
    for (let part of parts) {
      if (at.files.has(part)) throw both(path)
      let next = at.dirs.get(part) ?? dir()
      at.dirs.set(part, next)
      at = next
    }
    if (at.dirs.has(name)) throw both(path)
    at.files.set(name, sha)
  }
  return root
}
