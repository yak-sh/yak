/**
 * What fills this computer's disks, as a duty: the module a server imports at
 * `@yaks/file/service`. Each pass reads the computer's disks (`df`), and walks
 * each one whose day has no look yet, or whose latest look is `AGAIN` old
 * (`du`, one filesystem at a time, at the lowest CPU and disk priority), into
 * the day's `occupancy` row. The Disks page reads only those rows (./page.ts),
 * so opening it measures nothing.
 *
 * A walk stopped by the process winding down is killed, and the next process
 * walks again from its first pass; what an earlier walk read is still in the
 * kernel's cache, so the next goes faster.
 *
 * @module
 */
import type { Graph } from '@yaks/graph'
import { sleep } from '@yaks/fp'
import { volumeOf } from './mod.ts'
import { here } from './local.ts'
import {
  type Disk,
  disks,
  due,
  entries,
  listed,
  occupancyIn,
  occupancyOf,
  type Walk,
  walked,
} from './occupancy.ts'

/** How long a pass waits for the next, in milliseconds: an hour. */
export let EVERY = 60 * 60 * 1000

/** How old a volume's latest look is before it is walked again: an hour. A
 * walk of this box's 140 GB takes half a minute once the kernel has its
 * directories cached, and sixteen minutes the first time after a boot. */
export let AGAIN = 60 * 60 * 1000

/** How a computer is looked at: its disks, and a walk of one. */
export type Looking = {
  disks: () => Promise<Disk[]>
  /** what a walk of the filesystem at `mount` counted, listing each path of
   * at least `least` bytes; undefined once `signal` aborts */
  walk: (
    mount: string,
    least: number,
    signal?: AbortSignal,
  ) => Promise<Walk | undefined>
}

let text = new TextDecoder()

// A command's output; undefined once `signal` aborts, which kills it. `du`
// says so and goes on when it cannot read a directory, exiting 1; what it
// counted leaves that directory out.
let run = async (
  [command, ...args]: string[],
  signal?: AbortSignal,
): Promise<string | undefined> => {
  let out = await new Deno.Command(command, {
    args,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    signal,
  }).output().catch((e: unknown) => {
    if (signal?.aborted) return undefined
    throw e
  })
  if (!out || signal?.aborted) return undefined
  let said = text.decode(out.stdout)
  if (out.code == 0 || (out.code == 1 && said)) return said
  throw Error(
    `${command} exited ${out.code}: ${text.decode(out.stderr).slice(0, 400)}`,
  )
}

/** This computer, looked at through `df` and `du`. */
export let computer: Looking = {
  disks: async () =>
    disks(
      await run([
        'df',
        '-B1',
        '--output=source,fstype,size,used,avail,target',
      ]) ??
        '',
    ),
  walk: async (mount, least, signal) => {
    let out = await run([
      'ionice',
      '-c3',
      'nice',
      '-n19',
      'du',
      '-x',
      '-a',
      '-0',
      '-B1',
      `--threshold=${least}`,
      mount,
    ], signal)
    if (out == null) return undefined
    let found = entries(out)
    let dirs = new Set<string>()
    for (let [, path] of found) {
      let stat = await Deno.lstat(path).catch(() => undefined)
      if (stat?.isDirectory) dirs.add(path)
    }
    return walked(found, mount, dirs)
  },
}

/** One pass: walk each of this computer's disks that is due a look, into its
 * day's row. */
export let pass = async (
  g: Graph,
  look: Looking = computer,
  now: number = Date.now(),
  signal?: AbortSignal,
): Promise<void> => {
  let machine = await here(g)
  let day = new Date(now).toISOString().slice(0, 10)
  for (let disk of await look.disks()) {
    let volume = volumeOf(machine, disk.mount)
    let eid = occupancyOf(volume, day)
    let held = await g.get([eid, volume], ['occupancy', 'volume'])
    let had = held.find((b) => b.entity.eid == eid)
    let known = held.find((b) => b.entity.eid == volume)
    if (!due(occupancyIn(had), now, AGAIN)) continue
    let walk = await look.walk(disk.mount, listed(disk.size), signal)
    if (!walk) return
    // The filesystem's figures as the walk ends, so they and it agree.
    let { size, used, free } = (await look.disks()).find((d) =>
      d.mount == disk.mount
    ) ?? disk
    await g.apply([
      ...known?.volume
        ? []
        : [{ entity: { eid: volume }, volume: { machine, mount: disk.mount } }],
      {
        entity: { eid },
        occupancy: {
          volume,
          day,
          at: new Date().toISOString(),
          size,
          used,
          free,
          ...walk,
        },
      },
    ], { trusted: true })
  }
}

/** Look, then look again every `every`, until the signal aborts. An already
 * aborted signal is one pass. */
export let service = async (
  host: {
    graph: Graph
    report?: (
      error: unknown,
      context?: { tags?: Record<string, string> },
    ) => unknown
  },
  options: { every?: number } = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  for (;;) {
    try {
      await pass(
        host.graph,
        computer,
        Date.now(),
        signal.aborted ? undefined : signal,
      )
    } catch (e) {
      // A pass that failed is told, and the next one looks again.
      ;(host.report ?? console.error)(e, { tags: { step: 'disk look' } })
    }
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
