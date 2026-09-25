// The process you are IN, recorded like any other.
//
// This package already describes a program running on a machine, with
// `process{pid, command, cwd}` and then `exit{code}` once it is over, and it
// describes programs somebody here launched. The one it never described was
// the program doing the launching. So it does now: a process opening a graph
// writes a row for itself on the way in, and records its exit code on the way
// out.
//
// Two things follow from that row, and they are why it is worth writing.
//
// A write has an author even when no client made a request — the rules a
// transaction fires, the effects that run after it commits, a file somebody
// imports — and the author is this run of this program, not a name a config
// file made up. So this row is what the server signs its writes with
// (@yaks/cli), which makes `created.by` on any row the answer to "which run
// wrote this", and a child process's row, written by its parent, identifies its
// parent without needing a property for it.
//
// A process starting is also an event: an effect declared on
// `created: ["process"]` is what a process coming up owes, so start-up work is
// an ordinary effect instead of a separate start-up hook nothing else can see.
//
// The id is minted once, in memory, and it is a uuid rather than something
// derived from the process: two runs of one command are two different runs, and
// the kernel recycles a pid within the hour. A worker thread the process
// started is the same run, and says so with {@link become}.

import type { Bundle, Eid } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'

let mine: Eid | undefined

/** This process, as an entity — minted once, the same for every graph it
 * opens. */
export let selfEid = (): Eid => mine ??= crypto.randomUUID() as Eid

/** Join the process `eid` names: a worker thread is its own module realm, so
 * it would mint an id of its own, and it is the same run of the same program
 * as the thread that started it. Called before anything asks
 * {@link selfEid}; a thread that already is another process refuses. */
export let become = (eid: Eid): void => {
  if (mine && mine != eid) throw new Error(`this thread is ${mine} already`)
  mine = eid
}

/** What a run records about itself where the runtime cannot tell it (a test
 * standing in for a process, a caller naming its children its own way). */
export type SelfOpts = {
  /** the process id (default this one's) */
  pid?: number
  /** the command line, argv joined by spaces (default this one's) */
  command?: string
  /** where it runs (default this one's) */
  cwd?: string
}

let line = (): string => {
  try {
    return [Deno.execPath().split('/').pop(), ...Deno.args].join(' ')
  } catch {
    return 'yak'
  }
}

let here = (): string | undefined => {
  try {
    return Deno.cwd()
  } catch {
    return undefined
  }
}

/**
 * The bundle a process writes when it starts: itself, running.
 *
 * ```ts
 * import { started } from '@yaks/process'
 *
 * // await graph.apply([started()])
 * ```
 */
export let started = (o: SelfOpts = {}): Bundle => {
  let cwd = o.cwd ?? here()
  return {
    entity: { eid: selfEid() },
    [PROCESS]: {
      pid: o.pid ?? Deno.pid,
      command: o.command ?? line(),
      ...cwd ? { cwd } : {},
    },
  }
}

/**
 * The bundle it writes at the end. A code it does not know is left out rather
 * than guessed — an `exit` with nothing in it still records that the run is
 * over, which is the fact anything reading the row is after.
 */
export let ended = (code?: number | null): Bundle => ({
  entity: { eid: selfEid() },
  [EXIT]: code == null ? {} : { code },
})
