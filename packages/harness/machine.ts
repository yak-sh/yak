// The machine tools, declared once: run a command, wait for one that outlived
// its tool call, stop one, read a file, write one. Which machine they reach is
// the host's to lend: a box lends its own through @yaks/process (./box.ts),
// and the Cloudflare host lends its sandbox container (workers/yak/sandbox.ts).
//
// Every command is a process from its first moment, with an id the machine
// gives it, so the only thing a call's timeout decides is whether the tool
// answers the output or that id. A call that blocked until a dev server exited
// would hang the session; one that killed the child at its timeout could only
// ever run short commands. Answering the id does neither: the child keeps
// running, and `wait` and `stop` reach it again by that id.
//
// Nothing here touches a runtime. The file is imported by the box and by a
// Worker alike, and every effect is one of the machine's five verbs.

import type { Tool, ToolContext } from '@yaks/session'

/** A process as the machine holds it: `exit` is absent while it runs, and its
 * code is null when the machine could not learn it. */
export type Proc = { pid?: number; exit?: { code: number | null } }

/** What a host lends the machine tools. */
export type Machine = {
  /** starts a command line, run by bash, and answers its id */
  start(command: string, cwd?: string): Promise<string>
  /** the process by that id, or null when the machine has none */
  look(id: string): Promise<Proc | null>
  /** the last `n` lines it printed */
  tail(id: string, n: number): Promise<string[]>
  /** asks it to end */
  kill(id: string, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>
  read(path: string): Promise<string>
  /** replaces what the path held, making its directory where it has none */
  write(path: string, content: string): Promise<void>
  /** how often a waiting call looks again (ms, default 100) */
  poll?: number
}

/** How the machine tools behave, all optional. */
export type MachineOpts = {
  /** how long `shell` waits for its command before answering the process id
   * instead (ms, default 5000); a `timeout` argument overrides it per call */
  budget?: number
  /** how long `stop` gives SIGTERM before SIGKILL (ms, default 2000) */
  grace?: number
  /** how many lines of output an answer carries (default 40) */
  lines?: number
  /** where a call runs when it names no directory, and what a relative path is
   * read from */
  cwd?: (ctx?: ToolContext) => string | undefined | Promise<string | undefined>
}

let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))

/** Whether a path names its own root.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert(rooted('/etc/hosts') && rooted('C:\\tmp') && !rooted('src/lib.rs'))
 * ```
 */
export let rooted = (path: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(path)

let under = (dir: string | undefined, path: string) =>
  dir == null || rooted(path) ? path : `${dir.replace(/\/+$/, '')}/${path}`

let code = (c: number | null) =>
  c == null ? 'exited, code unknown' : `exited ${c}`

let pid = (p: Proc) => p.pid ? ` (pid ${p.pid})` : ''

let str = (description: string) => ({ type: 'string', description })

/**
 * The machine tools over a machine: `shell`, `wait`, `stop`, `read`, `write`.
 *
 * A command that finishes within its timeout answers its code and output; one
 * that does not answers its process id, still running, for `wait` and `stop`
 * to name.
 */
export let machineTools = (m: Machine, o: MachineOpts = {}): Tool[] => {
  let poll = m.poll ?? 100
  let budget = o.budget ?? 5000
  let lines = o.lines ?? 40
  let here = async (ctx?: ToolContext) => await o.cwd?.(ctx)

  // The process once it has ended or `ms` has passed, whichever is first;
  // null for an id the machine does not know.
  let settle = async (id: string, ms: number) => {
    for (let end = Date.now() + ms;;) {
      let p = await m.look(id)
      if (!p || p.exit || Date.now() >= end) return p
      await sleep(Math.max(0, Math.min(poll, end - Date.now())))
    }
  }

  let told = async (id: string, head: string) =>
    [head, ...await m.tail(id, lines)].join('\n')

  return [{
    name: 'shell',
    description:
      'Run a shell command. A command still running when the timeout passes ' +
      'keeps running as a process: the result gives its id, and wait or stop ' +
      'accepts that id.',
    parameters: {
      type: 'object',
      properties: {
        command: str('the command line, run by bash'),
        cwd: str('where to run it'),
        timeout: {
          type: 'number',
          description: `milliseconds to wait for it (default ${budget})`,
        },
      },
      required: ['command'],
    },
    run: async (args, ctx) => {
      let ms = Number(args.timeout ?? budget)
      // The timeout covers the whole call, the start included; a child that
      // outlived it is reported as running even if it exits a moment later.
      let end = Date.now() + ms
      let cwd = args.cwd == null ? await here(ctx) : String(args.cwd)
      let id = await m.start(String(args.command ?? ''), cwd)
      let p = await settle(id, end - Date.now()) ?? {}
      return told(
        id,
        p.exit
          ? `process ${id} ${code(p.exit.code)}`
          : `process ${id} still running${pid(p)} after ${ms}ms — ` +
            'wait or stop it by that id',
      )
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
        process: str('the process id'),
        timeout: {
          type: 'number',
          description: 'milliseconds to wait (default 60000)',
        },
      },
      required: ['process'],
    },
    run: async (args) => {
      let id = String(args.process ?? '')
      let ms = Number(args.timeout ?? 60_000)
      let p = await settle(id, ms)
      if (!p) return `no such process: ${id}`
      return told(
        id,
        p.exit
          ? `process ${id} ${code(p.exit.code)}`
          : `process ${id} still running${pid(p)} after ${ms}ms`,
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
        process: str('the process id'),
        grace: {
          type: 'number',
          description: 'milliseconds between the two signals (default 2000)',
        },
      },
      required: ['process'],
    },
    run: async (args) => {
      let id = String(args.process ?? '')
      let p = await m.look(id)
      if (!p) return `no such process: ${id}`
      if (p.exit) return `process ${id} ${code(p.exit.code)} already`
      let grace = Number(args.grace ?? o.grace ?? 2000)
      await m.kill(id, 'SIGTERM')
      p = await settle(id, grace)
      if (!p?.exit) {
        await m.kill(id, 'SIGKILL')
        p = await settle(id, grace)
      }
      return p?.exit
        ? `process ${id} ${code(p.exit.code)}`
        : `process ${id} signalled, no exit recorded yet`
    },
  }, {
    name: 'read',
    description: 'Read a text file.',
    parameters: {
      type: 'object',
      properties: {
        path: str('the file, from the working directory unless rooted'),
      },
      required: ['path'],
    },
    run: async (args, ctx) =>
      await m.read(under(await here(ctx), String(args.path ?? ''))),
  }, {
    name: 'write',
    description:
      'Write a text file, replacing whatever the path held and making its ' +
      'directory if there is none.',
    parameters: {
      type: 'object',
      properties: {
        path: str('the file, from the working directory unless rooted'),
        content: str('the whole text of the file'),
      },
      required: ['path', 'content'],
    },
    run: async (args, ctx) => {
      let path = String(args.path ?? '')
      await m.write(under(await here(ctx), path), String(args.content ?? ''))
      return `wrote ${path}`
    },
  }]
}
