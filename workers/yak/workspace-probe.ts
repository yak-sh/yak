import type { Env } from './env.ts'

/** One command, as the stand-in sandbox was told to answer it. */
export type Ran = {
  stdout?: string
  stderr?: string
  exitCode?: number
  /** a process that keeps running until it is killed */
  running?: boolean
}

/**
 * The builder's workbench, in memory (sandbox.ts): a scripted answer per
 * command and a Map for a filesystem. It is here beside the Store and the
 * bucket for the same reason they are — a second copy of what a sandbox
 * answers is a second answer to what a sandbox is — and it keeps the tools
 * that reach for one testable with no container anywhere.
 *
 * `answer` is asked for every command; what it returns is what `exec` says,
 * and what a process `startProcess` began has printed and exited with.
 * Undefined is a command that did nothing and exited 0.
 */
export let sandboxes = (answer: (cmd: string) => Ran | void = () => {}) => {
  let ran: string[] = []
  // The environment each command was handed (sandbox.ts `signed`), in order.
  let env: Record<string, string>[] = []
  let files = new Map<string, string>()
  let alive = new Set<string>()
  let copies = new Map<string, Set<string>>()
  let states = new Map<
    string,
    { files: Map<string, string>; processes: typeof processes }
  >()
  let sequence = 0
  // Every process a `startProcess` began, by its id, kept after it exits.
  let processes = new Map<
    string,
    {
      pid: number
      status: string
      exitCode?: number
      stdout: string
      stderr: string
    }
  >()
  let state = (name: string) => {
    let row = states.get(name)
    if (!row) {
      row = { files: states.size ? new Map() : files, processes: new Map() }
      states.set(name, row)
    }
    return row
  }
  type Opts = { cwd?: string; timeout?: number; env?: Record<string, string> }
  let heard = (name: string, cmd: string, opts?: Opts) => {
    files = state(name).files
    alive.add(name)
    ran.push(cmd)
    env.push(opts?.env ?? {})
    return answer(cmd) ?? {}
  }
  let box = (name: string) => ({
    getState: () =>
      Promise.resolve({ status: alive.has(name) ? 'healthy' : 'stopped' }),
    listProcesses: () =>
      Promise.resolve(
        [...state(name).processes].map(([id, p]) => ({ id, ...p })),
      ),
    exec: (cmd: string, opts?: Opts) => {
      let said = heard(name, cmd, opts)
      return Promise.resolve({
        stdout: said.stdout ?? '',
        stderr: said.stderr ?? '',
        exitCode: said.exitCode ?? 0,
        cwd: opts?.cwd,
      })
    },
    startProcess: (cmd: string, opts?: Opts) => {
      let said = heard(name, cmd, opts)
      let id = `proc-${++sequence}`
      let pid = sequence + 99
      state(name).processes.set(id, {
        pid,
        status: said.running ? 'running' : 'completed',
        exitCode: said.running ? undefined : said.exitCode ?? 0,
        stdout: said.stdout ?? '',
        stderr: said.stderr ?? '',
      })
      return Promise.resolve({ id, pid })
    },
    getProcess: (id: string) => {
      let p = state(name).processes.get(id)
      return Promise.resolve(p ? { id, ...p } : null)
    },
    killProcess: (id: string) => {
      let p = state(name).processes.get(id)
      if (p?.status == 'running') p.status = 'killed'
      return Promise.resolve()
    },
    getProcessLogs: (id: string) => {
      let p = state(name).processes.get(id)
      return Promise.resolve({
        stdout: p?.stdout ?? '',
        stderr: p?.stderr ?? '',
      })
    },
    mkdir: () => Promise.resolve({ success: true }),
    writeFile: (
      path: string,
      content: string,
      opts?: { encoding?: string },
    ) => {
      alive.add(name)
      files = state(name).files
      files.set(
        path,
        opts?.encoding == 'base64'
          ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(
            Uint8Array.fromBase64(content),
          )
          : content,
      )
      return Promise.resolve({ success: true })
    },
    readFile: (path: string, opts?: { encoding?: string }) => {
      alive.add(name)
      files = state(name).files
      let held = files.get(path)
      if (held == null) return Promise.reject(new Error(`no file ${path}`))
      return Promise.resolve({
        content: opts?.encoding == 'base64'
          ? btoa(String.fromCharCode(...new TextEncoder().encode(held)))
          : held,
      })
    },
    fork: (target: string) => {
      let children = copies.get(name) ?? new Set<string>()
      if (!children.has(target)) {
        children.add(target)
        copies.set(name, children)
        let source = states.get(name)
        if (source) {
          let next = state(target)
          for (let [path, value] of source.files) next.files.set(path, value)
        }
      }
      return Promise.resolve([...states.get(name)?.processes.keys() ?? []])
    },
    forks: () => Promise.resolve([...copies.get(name) ?? []]),
    retire: () => Promise.resolve([...copies.get(name) ?? []]),
    destroy: () => {
      alive.delete(name)
      states.get(name)?.files.clear()
      states.get(name)?.processes.clear()
      copies.delete(name)
      return Promise.resolve()
    },
  })
  return {
    ran,
    env,
    get files() {
      return files
    },
    alive,
    // `getSandbox` addresses one by name off the namespace; nothing here
    // needs an id object, so the name is the id.
    WORKBENCH: {
      idFromName: (n: string) => n,
      getByName: (n: string) => box(n),
      get: (n: unknown) => box(String(n)),
    },
  }
}

// The test namespace's coordinator records filesystem copies independently
// of command invocations, as WORKSPACES does beside WORKBENCH in production.
export let workspaces = (
  ns: NonNullable<Env['WORKBENCH']>,
): NonNullable<Env['WORKSPACES']> => ({
  idFromName: (name) => name,
  get: (id) => {
    let source = ns.get(ns.idFromName(String(id))) as ReturnType<
      ReturnType<typeof sandboxes>['WORKBENCH']['get']
    >
    return {
      fork: (_name, target) => source.fork(target),
      retire: () => source.retire(),
      destroy: () => Promise.resolve(),
    }
  },
})
