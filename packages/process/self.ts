// The process you are IN, as a row like any other.
//
// This package already says what a program on a host is — `process{pid,
// command, cwd}`, and `exit{code}` when it is over — and says it about
// programs somebody here launched. The one it never said it about was the
// program doing the launching. So it does now: a process opening a graph
// writes itself in on the way through, and stamps its ending on the way out.
//
// Two things fall out of that, and they are why it is worth a row.
//
// A write has an author even when nobody is at a door — the rules a batch
// fires, the effects after it commits, a file somebody pours in — and the
// author is THIS RUN of this program, not a name a config made up. So the
// process row is what a host signs with (@yaks/cli), which makes `created.by`
// on any row the answer to "which run wrote this", and a child's row, written
// by the parent, says whose child it is without a column for it.
//
// And a process starting is an EVENT. `created(process)` where the process is
// this one is the moment a host has to pick up what a restart left behind —
// the agents still running, the locks a dead session held — so start-up work
// is an ordinary post-commit effect instead of a facet nobody else can see.
//
// The id is minted once, in memory, and it is a uuid rather than something
// derived: two runs of one command are two different runs, and a pid is
// recycled by the kernel within the hour.

import type { Bundle, Eid } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'

let mine: Eid | undefined

/** This process, as an entity — minted once, the same for every graph it
 * opens. */
export let selfEid = (): Eid => mine ??= crypto.randomUUID() as Eid

/** What a run says about itself where the runtime does not say (a test
 * standing in for a process, a host naming its children one way). */
export type SelfOpts = {
  /** the process id (default this one's) */
  pid?: number
  /** the command line, argv joined by a space (default this one's) */
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
 * The bundle a process writes at start: itself, running.
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
 * than guessed — `exit` with nothing in it still says the run is over, which
 * is the fact anything reading the row is after.
 */
export let ended = (code?: number | null): Bundle => ({
  entity: { eid: selfEid() },
  [EXIT]: code == null ? {} : { code },
})
