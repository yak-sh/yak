/** Filesystem measurements through the host's file API, without commands. */
import * as disk from './io.ts'
import type { Disk, Walk } from './occupancy.ts'

export type Filesystem = Pick<
  typeof disk,
  'lstat' | 'readDir' | 'realPath' | 'space'
>

// A path can disappear while measuring; protected directories remain uncounted.
let readable = (error: unknown): undefined => {
  if (!disk.isNotFound(error) && !disk.isPermissionDenied(error)) throw error
}

/** Allocated bytes, counting hard links once and stopping at other devices.
 * Symlinks are measured themselves; their targets are never followed. */
export let walk = async (
  mount: string,
  least: number,
  signal?: AbortSignal,
  fs: Filesystem = disk,
): Promise<Walk | undefined> => {
  let root = await fs.lstat(mount)
  let seen = new Set<number>()
  let paths: Record<string, number> = {}
  let visit = async (absolute: string, path: string): Promise<number> => {
    if (signal?.aborted) return 0
    let stat = await fs.lstat(absolute).catch(readable)
    if (!stat || stat.dev != root.dev || seen.has(stat.ino)) return 0
    seen.add(stat.ino)
    let bytes = stat.blocks == null ? stat.size : stat.blocks * 512
    if (stat.isDirectory) {
      try {
        for await (let entry of fs.readDir(absolute)) {
          if (signal?.aborted) break
          bytes += await visit(
            disk.join(absolute, entry.name),
            path ? path + '/' + entry.name : entry.name,
          )
        }
      } catch (error) {
        readable(error)
      }
    }
    if (path && bytes >= least) {
      paths[path + (stat.isDirectory ? '/' : '')] = bytes
    }
    return bytes
  }
  let counted = await visit(mount, '')
  return signal?.aborted ? undefined : { counted, paths }
}

/** The filesystems holding `places`, each once, at its mount: the highest
 * directory above a place that is still on the place's device. */
export let disksAt = async (
  places: string[],
  fs: Filesystem = disk,
): Promise<Disk[]> => {
  let found = new Map<number, Disk>()
  for (let place of places) {
    let mount = await fs.realPath(place)
    let { dev } = await fs.lstat(mount)
    if (found.has(dev)) continue
    for (let up = disk.dirname(mount); up != mount; up = disk.dirname(up)) {
      if ((await fs.lstat(up)).dev != dev) break
      mount = up
    }
    found.set(dev, { mount, ...await fs.space(mount) })
  }
  return [...found.values()].toSorted((a, b) => a.mount.localeCompare(b.mount))
}
