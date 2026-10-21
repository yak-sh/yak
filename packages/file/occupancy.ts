/**
 * What fills a volume, as a look at it records it:
 * `occupancy{volume, day, at, size, used, free, counted, paths}`, one row a
 * volume a UTC day. Here are reading `df` and `du` into one, and reading a run
 * of them the way the Disks page does: what a directory holds, what is too
 * small to list, which directories are drawn open, the largest files, the
 * change between two looks, and which file is the graph's own. Pure; looking
 * is ./service.ts, drawing ./page.ts.
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { fileOf, placed, size } from './mod.ts'

/** A look at a volume. */
export type Occupancy = {
  volume: Eid
  day: string
  at: string
  size: number
  used: number
  free: number
  counted: number
  paths: Record<string, number>
}

/** A filesystem on a disk, as `df` reports it. */
export type Disk = { mount: string; size: number; used: number; free: number }

/** What a walk of a volume counted. */
export type Walk = Pick<Occupancy, 'counted' | 'paths'>

/// occupancyOf('v', '2026-10-21') == occupancyOf('v', '2026-10-21') -> true
/// occupancyOf('v', '2026-10-21') == occupancyOf('v', '2026-10-22') -> false
/** The entity a volume's day is: the eid `occupancy{volume, day}` derives. */
export let occupancyOf = (volume: Eid, day: string): Eid =>
  identityEid('occupancy', [volume, day])

/** A bundle's `occupancy`, if it has one. */
export let occupancyIn = (b?: Bundle): Occupancy | undefined =>
  b?.occupancy as Occupancy | undefined

/** The share of a volume a path takes to be listed: a thousandth. */
export let SHARE = 1 / 1000

/// listed(190e9) -> 190000000
/** The fewest bytes a path on a volume of `size` bytes holds to be listed. */
export let listed = (size: number): number => Math.ceil(size * SHARE)

// Filesystems kept on a local disk. One kept in memory, by the kernel, over
// a network or as a layer of images is not a disk to walk.
let DISK = new Set([
  'ext2',
  'ext3',
  'ext4',
  'xfs',
  'btrfs',
  'zfs',
  'f2fs',
  'bcachefs',
  'jfs',
  'reiserfs',
  'vfat',
  'exfat',
  'ntfs',
  'ntfs3',
  'fuseblk',
])

/**
 * The disks in `df -B1 --output=source,fstype,size,used,avail,target`'s
 * table: each local disk filesystem once, at its shortest mount, leaving out
 * those kept in memory, by the kernel or over a network.
 *
 * ```ts
 * import { disks } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let table = [
 *   'Filesystem Type 1B-blocks Used Avail Mounted on',
 *   '/dev/sda1 ext4 1000 600 300 /',
 *   'tmpfs tmpfs 50 1 49 /run',
 *   '/dev/sdb1 xfs 2000 100 1900 /mnt/my data',
 *   '/dev/sda1 ext4 1000 600 300 /srv/bind',
 * ].join('\n')
 * equal(disks(table), [
 *   { mount: '/', size: 1000, used: 600, free: 300 },
 *   { mount: '/mnt/my data', size: 2000, used: 100, free: 1900 },
 * ])
 * ```
 */
export let disks = (table: string): Disk[] => {
  let seen = new Map<string, Disk>()
  for (let line of table.split('\n')) {
    let m = line.trim().match(
      /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\/.*)$/,
    )
    if (!m || !DISK.has(m[2])) continue
    let [, source, , size, used, free, mount] = m
    let had = seen.get(source)
    if (had && had.mount.length <= mount.length) continue
    seen.set(source, { mount, size: +size, used: +used, free: +free })
  }
  return [...seen.values()].toSorted((a, b) => a.mount.localeCompare(b.mount))
}

/**
 * What `du -0 -B1` printed: each path it listed, with its bytes.
 *
 * ```ts
 * import { entries } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(entries('300\t/home/a.db\x00900\t/home\x00'), [[300, '/home/a.db'], [900, '/home']])
 * ```
 */
export let entries = (out: string): [bytes: number, absolute: string][] =>
  out.split('\0').flatMap((line) => {
    let tab = line.indexOf('\t')
    return tab > 0 ? [[+line.slice(0, tab), line.slice(tab + 1)]] : []
  })

/**
 * A walk under `mount`, from what `du` listed and which of those paths are
 * directories: the bytes counted under the mount, and each path below it from
 * the mount, a directory's ending in `/`.
 *
 * ```ts
 * import { walked } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let found: [number, string][] = [[300, '/home/a.db'], [900, '/home'], [1000, '/']]
 * equal(walked(found, '/', new Set(['/home', '/'])), {
 *   counted: 1000,
 *   paths: { 'home/a.db': 300, 'home/': 900 },
 * })
 * ```
 */
export let walked = (
  found: [bytes: number, absolute: string][],
  mount: string,
  dirs: Set<string>,
): Walk => {
  let walk: Walk = { counted: 0, paths: {} }
  for (let [bytes, absolute] of found) {
    let at = placed([mount], absolute)
    if (!at) continue
    if (!at.path) walk.counted = bytes
    else walk.paths[at.path + (dirs.has(absolute) ? '/' : '')] = bytes
  }
  return walk
}

/// parent('home/yaks/') -> 'home/'
/// parent('home/') -> ''
/// parent('home/yaks/yak.db') -> 'home/yaks/'
/** The directory a path is listed in; `''` is the mount. */
export let parent = (path: string): string => path.replace(/[^/]+\/?$/, '')

/// named('home/yaks/') -> 'yaks/'
/// named('home/yaks/yak.db') -> 'yak.db'
/** A path's own name, a directory's ending in `/`. */
export let named = (path: string): string => path.slice(parent(path).length)

/// directory('home/') -> true
/// directory('home/a.db') -> false
/** Whether a listed path is a directory. */
export let directory = (path: string): boolean => path.endsWith('/')

/** The bytes a path holds: `''`, the mount, holds what the walk counted. */
export let held = (o: Walk, path: string): number =>
  path == '' ? o.counted : o.paths[path] ?? 0

let largest = (a: [string, number], b: [string, number]) => b[1] - a[1]

/**
 * What a directory holds: the paths listed in it, largest first, and the
 * bytes of everything in it too small to list.
 *
 * ```ts
 * import { within } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let o = { counted: 1000, paths: { 'home/': 900, 'home/a.db': 300, 'home/b/': 500, 'usr/': 80 } }
 * equal(within(o, ''), { listed: [['home/', 900], ['usr/', 80]], rest: 20 })
 * equal(within(o, 'home/'), { listed: [['home/b/', 500], ['home/a.db', 300]], rest: 100 })
 * ```
 */
export let within = (
  o: Walk,
  dir: string,
): { listed: [string, number][]; rest: number } => {
  let listed = Object.entries(o.paths)
    .filter(([p]) => p != dir && parent(p) == dir)
    .toSorted(largest)
  let rest = held(o, dir) - listed.reduce((n, [, b]) => n + b, 0)
  return { listed, rest: Math.max(0, rest) }
}

/** The share of what is used a directory holds to be drawn open by itself. */
export let OPEN = 1 / 10

/**
 * Whether a directory is drawn open: as the person left it, or else when it
 * holds a tenth of what is used.
 *
 * ```ts
 * import { opens } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal([opens(undefined, 70, 600), opens(undefined, 50, 600)], [true, false])
 * equal([opens(false, 500, 600), opens(true, 5, 600)], [false, true])
 * ```
 */
export let opens = (
  chosen: boolean | undefined,
  bytes: number,
  used: number,
): boolean => chosen ?? bytes >= used * OPEN

/**
 * A change in bytes as read: blank where there is none, `new` where the older
 * look did not list the path.
 *
 * ```ts
 * import { change } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal([change(undefined, false), change(undefined, true), change(0, true)], ['', 'new', ''])
 * equal([change(1e8, true), change(-2e9, true)], ['+100 MB', '−2 GB'])
 * ```
 */
export let change = (n: number | undefined, compared: boolean): string =>
  n == null ? (compared ? 'new' : '') : n ? `${n > 0 ? '+' : ''}${size(n)}` : ''

/**
 * The bytes of a path that are free pages, where it is the file the graph
 * keeps its pages in, as the store's day's measurement names it
 * (`kept{file, free}`, @yaks/journal).
 *
 * ```ts
 * import { pagesFree } from './occupancy.ts'
 * import { fileOf } from './mod.ts'
 * import { equal } from '@yaks/testing'
 *
 * let kept = { file: fileOf('v', 'home/.yak/yak.db'), free: 3e9 }
 * equal(pagesFree(kept, 'v', 'home/.yak/yak.db'), 3e9)
 * equal(pagesFree(kept, 'v', 'tmp/copy/yak.db'), undefined)
 * ```
 */
export let pagesFree = (
  kept: { file?: string; free?: number } | undefined,
  volume: Eid,
  path: string,
): number | undefined =>
  kept?.file && kept.file == fileOf(volume, path) ? kept.free : undefined

/** A line of a volume's tree: a path listed, or what the directory `path`
 * holds too small to list (`rest`); how deep it sits, its bytes, and whether
 * it is a directory drawn open. */
export type Line = {
  path: string
  depth: number
  bytes: number
  open?: boolean
  rest?: true
}

/**
 * A volume's tree as lines, from `dir` down: each path listed in it, largest
 * first, an open directory's own lines beneath it, and last what the
 * directory holds too small to list. `open` says which directories are.
 *
 * ```ts
 * import { lines } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let o = { counted: 100, paths: { 'home/': 90, 'home/a.db': 60, 'usr/': 5 } }
 * equal(lines(o, (path) => path == 'home/'), [
 *   { path: 'home/', depth: 0, bytes: 90, open: true },
 *   { path: 'home/a.db', depth: 1, bytes: 60 },
 *   { path: 'home/', depth: 1, bytes: 30, rest: true },
 *   { path: 'usr/', depth: 0, bytes: 5, open: false },
 *   { path: '', depth: 0, bytes: 5, rest: true },
 * ])
 * ```
 */
export let lines = (
  o: Walk,
  open: (path: string, bytes: number) => boolean,
  dir = '',
  depth = 0,
): Line[] => {
  let { listed, rest } = within(o, dir)
  return [
    ...listed.flatMap(([path, bytes]): Line[] => {
      if (!directory(path)) return [{ path, depth, bytes }]
      let shown = open(path, bytes)
      return [
        { path, depth, bytes, open: shown },
        ...shown ? lines(o, open, path, depth + 1) : [],
      ]
    }),
    ...rest ? [{ path: dir, depth, bytes: rest, rest: true as const }] : [],
  ]
}

/**
 * The largest files listed, largest first.
 *
 * ```ts
 * import { files } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(files({ counted: 9, paths: { 'a/': 9, 'a/x': 2, 'a/y': 5 } }, 1), [['a/y', 5]])
 * ```
 */
export let files = (o: Walk, n: number): [string, number][] =>
  Object.entries(o.paths).filter(([p]) => !directory(p)).toSorted(largest)
    .slice(0, n)

/// uncounted({ used: 100, counted: 70 }) -> 30
/** The bytes in use the walk did not count: in directories it could not
 * read, or kept by the filesystem itself. */
export let uncounted = (o: Pick<Occupancy, 'used' | 'counted'>): number =>
  Math.max(0, o.used - o.counted)

/**
 * How much a path grew from an older look to a newer one; undefined where
 * the older look did not list it, so nothing is known of what it held then.
 *
 * ```ts
 * import { grew } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let older = { counted: 10, paths: { 'a/': 4 } }
 * let newer = { counted: 16, paths: { 'a/': 9, 'b/': 3 } }
 * equal([grew(older, newer, ''), grew(older, newer, 'a/'), grew(older, newer, 'b/')], [6, 5, undefined])
 * ```
 */
export let grew = (
  older: Walk | undefined,
  newer: Walk,
  path: string,
): number | undefined =>
  older && (path == '' || path in older.paths)
    ? held(newer, path) - held(older, path)
    : undefined

let DAY = 864e5

/**
 * The look to compare the newest against, from looks newest first: the
 * newest at least `days` older than it, or else the oldest there is.
 *
 * ```ts
 * import { since } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let at = (day: string) => ({ at: `${day}T04:00:00Z` })
 * let looks = [at('2026-10-21'), at('2026-10-15'), at('2026-10-14'), at('2026-10-01')]
 * equal(since(looks, 7), at('2026-10-14'))
 * equal(since(looks.slice(0, 2), 7), at('2026-10-15'))
 * equal(since(looks.slice(0, 1), 7), undefined)
 * ```
 */
export let since = <T extends { at: string }>(
  looks: T[],
  days: number,
): T | undefined => {
  let [newest, ...older] = looks
  if (!newest) return undefined
  let by = Date.parse(newest.at) - days * DAY
  return older.find((l) => Date.parse(l.at) <= by) ?? older.at(-1)
}

/**
 * `of`'s growth a day between an older look and a newer one.
 *
 * ```ts
 * import { perDay } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let older = { at: '2026-10-14T04:00:00Z', used: 100 }
 * let newer = { at: '2026-10-21T04:00:00Z', used: 800 }
 * equal(perDay(older, newer, (o) => o.used), 100)
 * equal(perDay(newer, newer, (o) => o.used), undefined)
 * ```
 */
export let perDay = <T extends { at: string }>(
  older: T,
  newer: T,
  of: (o: T) => number,
): number | undefined => {
  let days = (Date.parse(newer.at) - Date.parse(older.at)) / DAY
  return days > 0 ? (of(newer) - of(older)) / days : undefined
}

/**
 * Whether a volume is due a look: its day has none yet, or the latest is at
 * least `again` milliseconds old.
 *
 * ```ts
 * import { due } from './occupancy.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-10-21T12:00:00Z')
 * equal(due(undefined, now, 36e5), true)
 * equal(due({ at: '2026-10-21T11:30:00Z' }, now, 36e5), false)
 * equal(due({ at: '2026-10-21T11:00:00Z' }, now, 36e5), true)
 * ```
 */
export let due = (
  look: { at: string } | undefined,
  now: number,
  again: number,
): boolean => !look || now - Date.parse(look.at) >= again
