// Files as entities. A file is a path read in a root: a repository, whose files
// are abstract (a path in its tree, at any commit, on no disk), or a volume, a
// filesystem a machine mounts, whose files are bytes on a disk. A place in a
// file is `lines{file, start, end}` on whatever entity sits there.
//
// Everything here is pure: the eids the words derive, and where a machine's
// path sits among its mounts. Reading this computer is ./local.ts.

import type { Bundle, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'

/// fileOf('r', 'a/b.ts') == fileOf('r', 'a/b.ts') -> true
/// fileOf('r', 'a/b.ts') == fileOf('s', 'a/b.ts') -> false
/** The entity a path in a root is: the eid `file{path, root}` derives. */
export let fileOf = (root: Eid, path: string): Eid =>
  identityEid('file', [path, root])

/// volumeOf('m', '/') == volumeOf('m', '/') -> true
/** The entity a machine's mount is: the eid `volume{machine, mount}`
 * derives. */
export let volumeOf = (machine: Eid, mount: string): Eid =>
  identityEid('volume', [machine, mount])

/// placed(['/', '/mnt/data'], '/mnt/data/x.txt') -> { mount: '/mnt/data', path: 'x.txt' }
/// placed(['/'], '/home/yaks/a.jsonl') -> { mount: '/', path: 'home/yaks/a.jsonl' }
/// placed(['/mnt/data'], '/mnt/database/x') -> undefined
/** Where an absolute path sits among a machine's mounts: on the longest
 * mount that contains it, at the path from there. Nothing when no mount
 * contains it. */
export let placed = (
  mounts: string[],
  absolute: string,
): { mount: string; path: string } | undefined => {
  let within = (m: string) =>
    absolute == m || absolute.startsWith(m.endsWith('/') ? m : m + '/')
  let [mount] = mounts.filter(within).sort((a, b) => b.length - a.length)
  return mount == null
    ? undefined
    : { mount, path: absolute.slice(mount.length).replace(/^\/+/, '') }
}

/// joined('/', 'home/yaks/a.jsonl') -> '/home/yaks/a.jsonl'
/// joined('/mnt/data', 'x.txt') -> '/mnt/data/x.txt'
/** The absolute path a file on a volume has on the machine that mounts it. */
export let joined = (mount: string, path: string): string =>
  mount.replace(/\/+$/, '') + '/' + path

/// onVolume('v', 'a.txt')[0].file -> { path: 'a.txt', root: 'v' }
/** The bundle that makes a path on a volume a file. */
export let onVolume = (volume: Eid, path: string): Bundle[] => [{
  entity: { eid: fileOf(volume, path) },
  file: { path, root: volume },
}]
