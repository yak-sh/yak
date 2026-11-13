/** Keeping a disk clear of full: telling when one runs low, taking back
 * what a cache keeps for files that are gone, and dropping a cache that has
 * grown past its budget. */
import * as disk from './io.ts'
import type { Disk } from './occupancy.ts'

export type Pruning = Pick<typeof disk, 'lstat' | 'readDir' | 'remove'>

/// partOf('v8_code_cache_v2', 'v8_code_cache_v2-wal') -> true
/// partOf('v8_code_cache_v2', 'v8_code_cache_v2') -> true
/// partOf('v8_code_cache_v2', 'v8_code_cache_v3') -> false
/** Whether the file `name` is part of the cache file `cache`: the file
 * itself, or one named after it, as a database's `-wal` and `-shm` are. */
export let partOf = (cache: string, name: string): boolean =>
  name == cache || name.startsWith(cache + '-')

/// floorOf({ mount: '/', size: 1000, used: 0, free: 1000 }) -> 100
/// floorOf({ mount: '/', size: 1000, used: 0, free: 1000 }, 300) -> 300
/** The free bytes a disk is kept above: `floor` where the config sets one,
 * and a tenth of the disk otherwise. */
export let floorOf = (d: Disk, floor?: number): number => floor ?? d.size / 10

/// gb(6_900_000_000) -> '6.9 GB'
export let gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`

/** The disks newly below their floor, as errors to report. `told` holds the
 * mounts already reported in their present spell; a disk back above its floor
 * leaves it, so the next spell is reported again. */
export let lows = (
  disks: Disk[],
  told: Set<string>,
  floor?: number,
): Error[] =>
  disks.flatMap((d) => {
    let least = floorOf(d, floor)
    if (d.free >= least) return told.delete(d.mount), []
    if (told.has(d.mount)) return []
    told.add(d.mount)
    return [
      new Error(
        `${d.mount} has ${gb(d.free)} free of ${gb(d.size)}, below its floor ` +
          `of ${gb(least)}`,
      ),
    ]
  })

/** Remove each directory of `mirror`, a cache laid out by the absolute paths
 * of the files it was made from (Deno's emit cache, `gen/file`), whose own
 * directory is gone: nothing can read what it keeps again. Returns the
 * directories removed. A path that cannot be read is kept, and the walk stops
 * when `signal` aborts. */
export let prune = async (
  mirror: string,
  signal?: AbortSignal,
  fs: Pruning = disk,
): Promise<number> => {
  let base = mirror.replace(/\/+$/, '')
  let removed = 0
  let visit = async (path: string): Promise<void> => {
    let entries
    try {
      entries = await Array.fromAsync(fs.readDir(base + path))
    } catch (error) {
      if (disk.isNotFound(error) || disk.isPermissionDenied(error)) return
      throw error
    }
    for (let entry of entries) {
      if (signal?.aborted) return
      if (!entry.isDirectory) continue
      let source = path + '/' + entry.name
      let stat = await fs.lstat(source).then(
        (s) => s,
        (error) => disk.isNotFound(error) ? null : undefined,
      )
      if (stat === null) {
        await fs.remove(base + source, { recursive: true }).then(
          () => removed++,
          (error) => {
            if (!disk.isNotFound(error)) throw error
          },
        )
      } else if (stat?.isDirectory) await visit(source)
    }
  }
  await visit('')
  return removed
}

/** Remove `cache`, a file its program builds again when it is gone (Deno's
 * V8 code cache, keyed by each module's path, so every checkout adds a copy),
 * with the files named after it, once together they hold more than `most`
 * bytes. Returns the bytes removed. A process with it open keeps writing to
 * what it opened, and the next one starts a new cache. */
export let trim = async (
  cache: string,
  most: number,
  fs: Pruning = disk,
): Promise<number> => {
  let slash = cache.lastIndexOf('/')
  let dir = cache.slice(0, slash) || '/', name = cache.slice(slash + 1)
  let parts: { path: string; size: number }[] = []
  try {
    for await (let entry of fs.readDir(dir)) {
      if (!entry.isFile || !partOf(name, entry.name)) continue
      let path = dir.replace(/\/+$/, '') + '/' + entry.name
      let size = await fs.lstat(path).then((s) => s.size, () => 0)
      parts.push({ path, size })
    }
  } catch (error) {
    if (disk.isNotFound(error)) return 0
    throw error
  }
  let held = parts.reduce((sum, p) => sum + p.size, 0)
  if (held <= most) return 0
  for (let { path } of parts) {
    await fs.remove(path).catch((error) => {
      if (!disk.isNotFound(error)) throw error
    })
  }
  return held
}
