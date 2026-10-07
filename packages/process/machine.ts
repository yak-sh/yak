// Local machines and directory-separated process sandboxes. A host explicitly
// lends them; no caller acquires this filesystem by right. Commands are
// tracked process entities, and their output stays in the process backend's
// files so wait and recovery work after the launching host exits.

import { dirname, resolve } from '@std/path'
import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import {
  EXIT,
  type Exit,
  launch,
  type Opts,
  PROCESS,
  type Process,
  signal as processSignal,
  store,
  sweep,
  tail,
} from '@yaks/process'
import type {
  LentMachine,
  Machine,
  MachineProvider,
  MachineRef,
  Proc,
} from '@yaks/machine'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let HOUR = 60 * 60 * 1000
let DAY = 24 * HOUR

/**
 * A configured local filesystem as a machine: commands run by bash with the harness's environment,
 * each one a process entity in `g`, and files on this filesystem.
 */
export let processMachine = (
  g: Graph,
  o: Opts = {},
  env: (session?: string) => Record<string, string> = Deno.env.toObject,
  cwd?: string,
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
    sweep(DAY, opts).catch((e) => console.error('process sweep failed:', e))
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
    start: async (command, directory, call, session) => {
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
        env: env(session),
        cwd: directory == null
          ? cwd
          : cwd
          ? resolve(cwd, directory)
          : directory,
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
      if (pid) await processSignal(eid, pid, sig, opts)
    },
    read: (path) => Deno.readTextFile(cwd ? resolve(cwd, path) : path),
    write: async (path, content) => {
      path = cwd ? resolve(cwd, path) : path
      await Deno.mkdir(dirname(path), { recursive: true })
      await Deno.writeTextFile(path, content)
    },
  }
}

/** A process provider's configured directory and optional commit preparation.
 * Preparation reads the graph's commit/files through the host's doors; it
 * receives no graph storage or repository path from this provider. */
export type ProcessProviderOpts = {
  dir: string
  processes?: Opts
  env?: (session?: string) => Record<string, string>
  prepare?: (from: string, machine: Machine, cwd: string) => Promise<void>
}

/** Directory-separated process sandboxes and explicitly attached local
 * directories. This provider is not a security boundary: bash and rooted
 * file paths can still reach this filesystem. */
export let processProvider = (
  g: Graph,
  o: ProcessProviderOpts,
): MachineProvider => {
  let root = resolve(o.dir)
  let directory = (ref: MachineRef) => {
    if (ref.address != null) return resolve(ref.address)
    if (!/^[A-Za-z0-9_-]+$/.test(ref.id)) {
      throw new Error('process machine: id must be a single directory name')
    }
    return resolve(root, ref.id)
  }
  let lend = async (cwd: string): Promise<LentMachine> => {
    // Git does not examine a ceiling directory. Use the physical parent,
    // not cwd itself: the machine's own .git (including a worktree's gitfile)
    // must remain discoverable from both the root and its subdirectories.
    let ceiling = dirname(await Deno.realPath(cwd))
    return {
      cwd,
      machine: processMachine(g, o.processes, (session) => ({
        ...(o.env ?? Deno.env.toObject)(session),
        GIT_CEILING_DIRECTORIES: ceiling,
      }), cwd),
    }
  }
  let existing = async (ref: MachineRef) => {
    let cwd = directory(ref)
    if (!(await Deno.stat(cwd)).isDirectory) {
      throw new Error('process machine: address is not a directory')
    }
    return lend(cwd)
  }
  return {
    request: async (request) => {
      if (request.image != null) {
        throw new Error('process machine: this provider cannot boot images')
      }
      if (request.from != null && !o.prepare) {
        throw new Error('process machine: a commit needs a prepare function')
      }
      let cwd = directory(request)
      // A completed preparation is reused on a repeated request. An
      // interrupted preparation is retried, so the supplied function must be
      // idempotent, just like the provider's request.
      await Deno.mkdir(cwd, { recursive: true })
      let ready = `${cwd}/.machine-ready`
      try {
        let prior = await Deno.readTextFile(ready)
        if (prior != (request.from ?? '')) {
          throw new Error(
            'process machine: id already requested from another commit',
          )
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e
        if (request.from != null) {
          await o.prepare!(request.from, (await lend(cwd)).machine, cwd)
        }
        await Deno.writeTextFile(ready, request.from ?? '')
      }
      return lend(cwd)
    },
    attach: existing,
    wake: existing,
    release: async (ref) => {
      // An attached machine is not ours to delete or stop.
      if (ref.address != null) return
      let cwd = directory(ref)
      let rows = await g.read('.process&!exit')
      for (let row of rows) {
        let p = row[PROCESS] as Process
        if (p.cwd == cwd || p.cwd?.startsWith(cwd + '/')) {
          if (p.pid) {
            await processSignal(row.entity.eid, p.pid, 'SIGKILL', o.processes)
          }
        }
      }
      try {
        await Deno.remove(cwd, { recursive: true })
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e
      }
    },
    export: async function* (ref, paths) {
      let cwd = directory(ref)
      for (let path of paths) {
        let file = resolve(cwd, path)
        if (file == cwd || !file.startsWith(cwd + '/')) {
          throw new Error(
            'process machine: exported paths must be under its directory',
          )
        }
        yield { path, bytes: await Deno.readFile(file) }
      }
    },
  }
}

export {
  type SandboxLimits,
  sandboxProvider,
  type SandboxProviderOpts,
} from './sandbox.ts'
