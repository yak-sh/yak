// The box's machine: what @yaks/harness's machine tools (./machine.ts) run on
// when the harness runs here. A command is a tracked process from the first
// moment (`launch` writes the row before anything is waited on), and its exit
// lands on the same row as `exit{code}`. What it prints stays in the run's
// files, never the graph: the tool's answer carries the lines the model reads.
// The files stay for as long as a `wait` or a recovered call might read them
// again, and are swept a day after the run ends.
//
// `look` reads that row rather than a handle held in memory, so a process the
// server launched before a restart behaves exactly like one it launched a
// moment ago: `watch()` adopts it again and writes the exit code to the row
// looked at here.

import { dirname } from '@std/path'
import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import { sessionEnv } from '@yaks/session'
import {
  EXIT,
  type Exit,
  launch,
  type Opts,
  PROCESS,
  type Process,
  store,
  sweep,
  tail,
} from '@yaks/process'
import { diagnostics } from './diagnostics.ts'
import type { Machine, Proc } from './machine.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let HOUR = 60 * 60 * 1000
let DAY = 24 * HOUR

// Already gone is not a failure: the code watching the pid is recording it.
let signal = (pid: number, sig: Deno.Signal) => {
  try {
    Deno.kill(pid, sig)
  } catch { /* exited */ }
}

/**
 * This box as a machine: commands run by bash with the harness's environment,
 * each one a process entity in `g`, and files on this filesystem.
 */
export let boxMachine = (
  g: Graph,
  o: Opts = {},
  env: () => Record<string, string> = Deno.env.toObject,
): Machine => {
  // A tool call is interactive, so its process is polled on a short interval:
  // lines arrive and the exit code is written within it, not a second later.
  let opts: Opts = { ...o, poll: o.poll ?? 100 }
  let processes = store(g)
  let processFor = (call: string) => derivedEid(`shell process ${call}`)
  // At most once an hour, as a command starts: nothing is left to sweep on a
  // machine that runs none.
  let swept = 0
  let tidy = () => {
    if (Date.now() - swept < HOUR) return
    swept = Date.now()
    sweep(DAY, opts).catch((e) =>
      diagnostics().report(e, { phase: 'process-sweep' })
    )
  }
  let look = async (eid: string): Promise<Proc | null> => {
    let [self] = await g.get([eid])
    if (!self) return null
    let pid = Number((comp(self, PROCESS) as Process | undefined)?.pid ?? 0)
    let exit = comp(self, EXIT) as Exit | undefined
    return {
      ...pid ? { pid } : {},
      ...exit ? { exit: { code: exit.code ?? null } } : {},
    }
  }
  return {
    poll: opts.poll,
    start: async (command, cwd, call, session) => {
      tidy()
      let eid = call ? processFor(call) : undefined
      if (eid) {
        let [prior] = await g.get([eid])
        if (prior?.[PROCESS]) return eid
        // The receipt precedes the external act. An interrupted launch can
        // then be inspected without starting the command a second time.
        await g.apply([{ entity: { eid }, [PROCESS]: {} }])
      }
      return (await launch(processes, {
        command: 'bash',
        args: ['-c', command],
        env: session ? sessionEnv(session, env()) : env(),
        cwd,
      }, { ...opts, ...eid ? { eid } : {} })).eid
    },
    receipt: async (call) => {
      let eid = processFor(call)
      let [row] = await g.get([eid])
      return row?.[PROCESS] ? eid : undefined
    },
    look,
    tail: (eid, n) => Promise.resolve(tail(eid, n, opts)),
    kill: async (eid, sig) => {
      let pid = (await look(eid))?.pid
      if (pid) signal(pid, sig)
    },
    read: (path) => Deno.readTextFile(path),
    write: async (path, content) => {
      await Deno.mkdir(dirname(path), { recursive: true })
      await Deno.writeTextFile(path, content)
    },
  }
}
