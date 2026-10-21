// This computer, and the files on its disks: the effects at the package's edge.
// The computer is the machine addressed `local://`, written once; a directory
// is never a computer's identity, and nothing remote calls this. Its volumes
// are rows: a path sits on the one with the longest mount that contains it,
// and the root volume (`/`) is written the first time a path needs it.
//
// Both are read once per graph. A volume written later is seen by a process
// that starts after it, and moving files already placed onto it is a
// migration.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { mint } from '@yaks/graph'
import { joined, onVolume, placed, volumeOf } from './mod.ts'

let found = async (g: Graph): Promise<Eid> => {
  let held = await g.read('.machine.address=local://')
  if (held.length > 1) throw Error('Multiple computers claim local://')
  if (held[0]) return held[0].entity.eid
  let eid = mint()
  await g.apply([{ entity: { eid }, machine: { address: 'local://' } }])
  return eid
}

let mounted = async (g: Graph): Promise<Map<string, Eid>> => {
  let machine = await here(g)
  let rows = await g.read(`.volume.machine=${machine}`)
  let mounts = new Map(
    rows.map((b) => [String((b.volume as Comp).mount), b.entity.eid]),
  )
  if (!mounts.has('/')) {
    let eid = volumeOf(machine, '/')
    await g.apply([{ entity: { eid }, volume: { machine, mount: '/' } }])
    mounts.set('/', eid)
  }
  return mounts
}

let perGraph = <T>(f: (g: Graph) => Promise<T>) => {
  let held = new WeakMap<Graph, Promise<T>>()
  return (g: Graph): Promise<T> => {
    let p = held.get(g)
    if (p) return p
    p = f(g)
    held.set(g, p)
    p.catch(() => held.delete(g))
    return p
  }
}

/** This computer: the machine addressed `local://`, written the first time
 * a graph is asked for it. */
export let here: (g: Graph) => Promise<Eid> = perGraph(found)

let volumes = perGraph(mounted)

/**
 * An absolute path on this computer, as the file it is: the bundle that makes
 * it one, on the volume that holds it. Writing it again writes the same
 * entity.
 *
 * ```ts
 * import { onDisk } from '@yaks/file/local'
 *
 * // let [file] = await onDisk(graph, '/home/me/.claude/projects/x.jsonl')
 * // file.file -> { path: 'home/me/.claude/projects/x.jsonl', root: <volume> }
 * ```
 */
export let onDisk = async (g: Graph, absolute: string): Promise<Bundle[]> => {
  let mounts = await volumes(g)
  let at = placed([...mounts.keys()], absolute)
  if (!at) throw Error(`No volume of this computer holds ${absolute}`)
  return onVolume(mounts.get(at.mount)!, at.path)
}

/** Where a file is on this computer's disks: its absolute path, or nothing
 * for a file in a repository or on another machine. */
export let absolute = async (
  g: Graph,
  file: Bundle,
): Promise<string | undefined> => {
  let { root, path } = (file.file ?? {}) as Comp
  if (root == null || path == null) return undefined
  let [volume] = await g.get([String(root)], ['volume'])
  let { machine, mount } = (volume?.volume ?? {}) as Comp
  if (machine == null || mount == null) return undefined
  let [computer] = await g.get([String(machine)], ['machine'])
  return (computer?.machine as Comp | undefined)?.address == 'local://'
    ? joined(String(mount), String(path))
    : undefined
}
