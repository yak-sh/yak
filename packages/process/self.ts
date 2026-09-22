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
// parent without needing a column for it.
//
// A process starting is also an event. `created(process)` where the process is
// this one is the moment the server has to pick up what a restart left behind —
// the agents still running, the locks a dead session held — so start-up work is
// an ordinary post-commit effect handler instead of a separate start-up hook
// nothing else can see.
//
// The id is minted once, in memory, and it is a uuid rather than something
// derived from the process: two runs of one command are two different runs, and
// the kernel recycles a pid within the hour.

import type { Bundle, Eid } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'

let mine: Eid | undefined

/** This process, as an entity — minted once, the same for every graph it
 * opens. */
export let selfEid = (): Eid => mine ??= crypto.randomUUID() as Eid

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
