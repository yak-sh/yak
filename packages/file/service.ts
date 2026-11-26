/**
 * What fills this computer's disks, as a duty: the module a server imports at
 * `@yaks/file/service`. Each pass reads the computer's disks, and walks
 * each one whose day has no look yet (one filesystem at a time through the
 * file API) into the day's `occupancy` row. A walk lstats every file on the
 * disk, about a CPU for minutes on a box of agents' checkouts, so a disk is
 * walked once a day, never more. The Disks page reads only those rows (./page.ts),
 * so opening it measures nothing.
 *
 * A walk stops when the process winds down, and the next process
 * walks again from its first pass; what an earlier walk read is still in the
 * kernel's cache, so the next goes faster.
 *
 * Each pass also tells the host of a disk newly below its floor, and every
 * `AGAIN` prunes the configured mirror caches (./upkeep.ts).
 *
 * @module
 */
import { disksAt, paced, walk } from './measure.ts'
import { homedir } from './io.ts'
import type { Graph } from '@yaks/graph'
import { sleep } from '@yaks/fp'
import { volumeOf } from './mod.ts'
import { here } from './local.ts'
import { lows, prune } from './upkeep.ts'
import {
  type Disk,
  listed,
  occupancyIn,
  occupancyOf,
  type Walk,
} from './occupancy.ts'

/** How long a pass waits for the next, in milliseconds: five minutes, so a
 * disk running low is told within them. A walk still waits for the next day. */
export let EVERY = 5 * 60 * 1000

/** How often the mirror caches are pruned: an hour. */
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

/** This computer, measured through the file API: the disks holding its root
 * and the home directory. */
export let computer: Looking = {
  disks: () => disksAt(['/', homedir()]),
  // A quarter of one CPU at most: unpaced, a walk held a whole CPU for over
  // ten minutes beside agents' test runs (bug 60286e2677).
  walk: (mount, least, signal) =>
    walk(mount, least, signal, undefined, paced()),
}

/** One pass: walk each of this computer's disks whose day has no look yet,
 * into its day's row. */
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
    if (occupancyIn(had)) continue
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

export type Options = {
  /** milliseconds between passes (default {@link EVERY}) */
  every?: number
  /** the free bytes each disk is kept above; below it the host is told once
   * a spell (default a tenth of the disk) */
  floor?: number
  /** caches laid out by the absolute paths of the files they were made from,
   * such as Deno's `gen/file`, pruned of directories whose files are gone
   * every `AGAIN` */
  mirrors?: string[]
}

/** Look, then look again every `every`, until the signal aborts. An already
 * aborted signal is one pass. Each pass tells the host of a disk newly below
 * its floor, as a failure: a full disk fails every write on it. */
export let service = async (
  host: {
    graph: Graph
    report?: (
      error: unknown,
      context?: { tags?: Record<string, string> },
    ) => unknown
  },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let report = (e: unknown, step: string) =>
    (host.report ?? console.error)(e, { tags: { step } })
  let told = new Set<string>()
  let pruned = 0
  for (;;) {
    let stopping = signal.aborted ? undefined : signal
    // Each step that failed is told, and the next pass tries it again.
    await computer.disks()
      .then((disks) => lows(disks, told, options.floor))
      .then((low) => low.forEach((e) => report(e, 'disk space')))
      .catch((e) => report(e, 'disk space'))
    if (Date.now() - pruned >= AGAIN) {
      pruned = Date.now()
      for (let mirror of options.mirrors ?? []) {
        await prune(mirror, stopping).catch((e) => report(e, 'cache prune'))
      }
    }
    await pass(host.graph, computer, Date.now(), stopping)
      .catch((e) => report(e, 'disk look'))
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
