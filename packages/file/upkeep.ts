/** Keeping a disk clear of full: telling when one runs low, and taking back
 * what a cache keeps for files that are gone. */
import * as disk from './io.ts'
import type { Disk } from './occupancy.ts'

export type Pruning = Pick<typeof disk, 'lstat' | 'readDir' | 'remove'>

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
