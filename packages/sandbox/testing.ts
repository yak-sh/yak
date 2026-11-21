// Cloudflare's Sandbox binding in memory (not part of the published package;
// see deno.json), as ./cloudflare.ts and a host's tools reach for it.

/** One command, as the stand-in sandbox was told to answer it. */
export type Ran = {
  stdout?: string
  stderr?: string
  exitCode?: number
  /** a process that keeps running until it is killed */
  running?: boolean
}

/**
 * A workbench in memory: a scripted answer per command and a Map for a
 * filesystem, so the tools that reach for a sandbox are testable with no
 * container anywhere.
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
  let retained = new Map<string, Map<string, string>>()
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
  type Opts = {
    cwd?: string
    timeout?: number
    env?: Record<string, string>
    processId?: string
  }
  let heard = (name: string, cmd: string, opts?: Opts) => {
    files = state(name).files
    alive.add(name)
    ran.push(cmd)
    env.push(opts?.env ?? {})
    return answer(cmd) ?? {}
  }
  let box = (name: string) => ({
    prepare: () => {
      if (!alive.has(name) && retained.has(name)) {
        state(name).files = new Map(retained.get(name))
      }
      return Promise.resolve()
    },
    purge: () => {
      retained.delete(name)
      alive.delete(name)
      states.get(name)?.files.clear()
      states.get(name)?.processes.clear()
      return Promise.resolve()
    },
    getState: () =>
      Promise.resolve({ status: alive.has(name) ? 'healthy' : 'stopped' }),
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
      let pid = ++sequence + 99
      let id = opts?.processId ?? `proc-${sequence}`
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
    destroy: () => {
      retained.set(name, new Map(state(name).files))
      alive.delete(name)
      states.get(name)?.files.clear()
      states.get(name)?.processes.clear()
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
