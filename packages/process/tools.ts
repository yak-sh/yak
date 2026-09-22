// The shell as three tools a model can call in a @yaks/session loop: run a
// command, wait for one that outlived its tool call, stop one. Every command
// is a tracked process from the first moment — `launch` writes the row before
// anything is waited on — so the only thing the timeout decides is whether the
// tool returns the output or the entity id.
//
// That is the whole idea. A tool call that blocks until a `deno task dev`
// exits hangs the session forever; one that kills the child when the timeout
// passes could only ever run short commands. Returning the process entity does
// neither: the child keeps running, its lines keep arriving as
// `content{body}` plus `output{source}` — the same rows the server picks up
// when it restarts — and the session (or an operator reading the same graph)
// reaches it again by that id.
//
// `wait` and `stop` read the EXIT code from the graph rather than from a
// handle held in memory, so a process the server launched before a restart
// behaves exactly like one it launched a moment ago: `watch()` adopts it again
// and writes the exit code to the same row these tools poll.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { CONTENT, OUTPUT, type Tool } from '@yaks/session'
import { EXIT, type Exit, PROCESS, type Process } from './comp.ts'
import { launch, type Opts } from './run.ts'
import { store } from './store.ts'

/** How the shell tools behave, all optional. */
export type ShellOpts = Opts & {
  /** how long a tool call waits for its command before returning the process
   * entity instead (ms, default 5000) — a `timeout` argument overrides it for
   * one call */
  budget?: number
  /** how long `stop` gives SIGTERM before SIGKILL (ms, default 2000) */
  grace?: number
  /** how many lines of output a returned string carries (default 40) */
  lines?: number
  /** where a command runs when the tool call does not give a directory
   * (default the server's own working directory) */
  cwd?: string
}

let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))

// The promise's value, or `undefined` when the timeout came first. The timer
// is cleared either way: a tool that left one pending would hold the process
// open.
let within = <T>(ms: number, p: Promise<T>): Promise<T | undefined> => {
  let id: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<undefined>((go) => {
      id = setTimeout(() => go(undefined), Math.max(0, ms))
    }),
  ]).finally(() => clearTimeout(id))
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let row = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/** What a process printed, its last `n` lines. */
let tailOf = async (g: Graph, eid: string, n: number) => {
  let said = (await g.read(`.${OUTPUT}.source=${eid}`))
    .map((b) => String(comp(b, CONTENT)?.body ?? ''))
  return said.slice(-n)
}

// The exit as the graph holds it, waited for. `null` while the process is
// still running: the caller decides what that means, since a tool call's
// timeout and a stop's grace period mean different things about the same
// missing component.
let ending = async (
  g: Graph,
  eid: string,
  ms: number,
  poll: number,
): Promise<Exit | null> => {
  for (let end = Date.now() + ms;;) {
    let exit = comp(await row(g, eid), EXIT) as Exit | undefined
    if (exit) return exit
    if (Date.now() >= end) return null
    await sleep(Math.min(poll, end - Date.now()))
  }
}

let code = (c: number | null | undefined) =>
  c == null ? 'exited, code unknown' : `exited ${c}`

let answer = (head: string, tail: string[]) => [head, ...tail].join('\n')

let signal = (pid: number, sig: Deno.Signal) => {
  try {
    Deno.kill(pid, sig)
    return true
  } catch {
    return false // already gone: the code watching the pid is recording it
  }
}

/**
 * The shell as a session's tools: `shell` runs a command, `wait` blocks on one
 * that outlived its tool call, `stop` ends it.
 *
 * ```ts
 * import { shellTools } from '@yaks/process'
 * // let tools = [...shellTools(graph), ...mine]
 * ```
 *
 * A command that finishes before its timeout returns its output; one that does
 * not returns the id of the process entity, still running, for `wait` and
 * `stop` to name.
 */
export let shellTools = (g: Graph, o: ShellOpts = {}): Tool[] => {
  // A tool call is interactive, so its process is polled on a short interval:
  // lines arrive and the exit code is written within it, not a second later.
  let opts: Opts = { ...o, poll: o.poll ?? 100 }
  let beat = opts.poll!
  let lines = o.lines ?? 40
  let processes = store(g)
  let pidOf = async (eid: string) =>
    Number((comp(await row(g, eid), PROCESS) as Process | undefined)?.pid ?? 0)

  return [{
    name: 'shell',
    description:
      'Run a shell command. A command still running when the timeout passes ' +
      'keeps running, tracked as a process entity: the result gives its id, ' +
      'and wait or stop accepts that id.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'the command line, run by bash',
        },
        cwd: { type: 'string', description: 'where to run it' },
        timeout: {
          type: 'number',
          description: 'milliseconds to wait for it (default 5000)',
        },
      },
      required: ['command'],
    },
    run: async (args) => {
      let command = String(args.command ?? '')
      let budget = Number(args.timeout ?? o.budget ?? 5000)
      let end = Date.now() + budget
      let run = await launch(processes, {
        command: 'bash',
        args: ['-c', command],
        env: Deno.env.toObject(),
        cwd: args.cwd == null ? o.cwd : String(args.cwd),
      }, opts)
      // The timeout covers the whole tool call, the launch included; a child
      // that outlived it is reported as running even if it exits a moment
      // later.
      let exit = await within(end - Date.now(), run.done.catch(() => null))
      let tail = await tailOf(g, run.eid, lines)
      return exit === undefined
        ? answer(
          `process ${run.eid} still running (pid ${run.pid}) after ` +
            `${budget}ms — wait or stop it by that id`,
          tail,
        )
        : answer(`process ${run.eid} ${code(exit)}`, tail)
    },
  }, {
    name: 'wait',
    description:
      'Wait for a process to exit. Returns its exit code and the last lines ' +
      'of its output, or reports that it is still running when the timeout ' +
      'passes.',
    parameters: {
      type: 'object',
      properties: {
        process: { type: 'string', description: 'the process entity id' },
        timeout: {
          type: 'number',
          description: 'milliseconds to wait (default 60000)',
        },
      },
      required: ['process'],
    },
    run: async (args) => {
      let eid = String(args.process ?? '')
      if (!await row(g, eid)) return `no such process: ${eid}`
      let pid = await pidOf(eid)
      let ms = Number(args.timeout ?? 60_000)
      let exit = await ending(g, eid, ms, beat)
      let tail = await tailOf(g, eid, lines)
      return answer(
        exit
          ? `process ${eid} ${code(exit.code)}`
          : `process ${eid} still running (pid ${pid}) after ${ms}ms`,
        tail,
      )
    },
  }, {
    name: 'stop',
    description:
      'Stop a process: SIGTERM, then SIGKILL if it is still running after ' +
      'the grace period. Returns its exit code.',
    parameters: {
      type: 'object',
      properties: {
        process: { type: 'string', description: 'the process entity id' },
        grace: {
          type: 'number',
          description: 'milliseconds between the two signals (default 2000)',
        },
      },
      required: ['process'],
    },
    run: async (args) => {
      let eid = String(args.process ?? '')
      let self = await row(g, eid)
      if (!self) return `no such process: ${eid}`
      let done = comp(self, EXIT) as Exit | undefined
      if (done) return `process ${eid} ${code(done.code)} already`
      let grace = Number(args.grace ?? o.grace ?? 2000)
      let pid = await pidOf(eid)
      if (pid) signal(pid, 'SIGTERM')
      let exit = await ending(g, eid, grace, beat)
      if (!exit && pid) {
        signal(pid, 'SIGKILL')
        exit = await ending(g, eid, grace, beat)
      }
      return exit
        ? `process ${eid} ${code(exit.code)}`
        : `process ${eid} signalled, no exit stamped yet`
    },
  }]
}
