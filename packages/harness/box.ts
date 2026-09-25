// The box's machine: what @yaks/harness's machine tools (./machine.ts) run on
// when the harness runs here. A command is a tracked process from the first
// moment (`launch` writes the row before anything is waited on), its lines
// arrive as `content{body}` plus `output{source}`, and its exit lands on the
// same row as `exit{code}`.
//
// `look` reads that row rather than a handle held in memory, so a process the
// server launched before a restart behaves exactly like one it launched a
// moment ago: `watch()` adopts it again and writes the exit code to the row
// looked at here.

import { dirname } from '@std/path'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { CONTENT, OUTPUT } from '@yaks/session'
import {
  EXIT,
  type Exit,
  launch,
  type Opts,
  PROCESS,
  type Process,
  store,
} from '@yaks/process'
import type { Machine, Proc } from './machine.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

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
export let boxMachine = (g: Graph, o: Opts = {}): Machine => {
  // A tool call is interactive, so its process is polled on a short interval:
  // lines arrive and the exit code is written within it, not a second later.
  let opts: Opts = { ...o, poll: o.poll ?? 100 }
  let processes = store(g)
  let look = async (eid: string): Promise<Proc | null> => {
    let [self] = await g.storage.tx((tx) => tx.get([eid]))
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
    start: async (command, cwd) =>
      (await launch(processes, {
        command: 'bash',
        args: ['-c', command],
        env: Deno.env.toObject(),
        cwd,
      }, opts)).eid,
    look,
    tail: async (eid, n) =>
      (await g.read(`.${OUTPUT}.source=${eid}&?${CONTENT}`))
        .map((b) => String(comp(b, CONTENT)?.body ?? ''))
        .slice(-n),
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
