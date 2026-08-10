// Codex account storage and RPC: one opaque credential blob moves through a
// locked staging CODEX_HOME, while app-server alone speaks OAuth and refresh.
// Nothing here parses auth.json or lets provider output cross as an error.
import { join } from 'node:path'

export type Rpc = {
  call: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
  notify: (method: string, params?: Record<string, unknown>) => Promise<void>
  wait: (method: string) => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

export type Issuer = {
  open: (home: string) => Promise<Rpc>
}

export type Stored = {
  home: string
  commit: () => Promise<void>
  close: () => Promise<void>
}

export type AuthStore = {
  begin: () => Promise<Stored>
}

type Env = (name: string) => string | undefined

let unavailable = () => new Error('codex account unavailable')

export let codexHome = (
  env: Env = (name) => Deno.env.get(name),
) => {
  let chosen = env('TASKS_CODEX_HOME')
  if (chosen) return chosen
  // Scratch servers must never inherit the owner's account. A disposable
  // canary opts in with an explicit root, just as provider sweeps do.
  if (env('DB_PATH')) return undefined
  let state = env('XDG_STATE_HOME')
  let home = env('HOME')
  return state
    ? `${state}/tasks/codex`
    : home
    ? `${home}/.local/state/tasks/codex`
    : undefined
}

export let nativeCodexAuth = (
  env: Env = (name) => Deno.env.get(name),
) => {
  let root = env('CODEX_HOME')
  if (root) return join(root, 'auth.json')
  let home = env('HOME')
  return home ? join(home, '.codex', 'auth.json') : undefined
}

let exists = async (path: string) => {
  try {
    return await Deno.lstat(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null
    throw error
  }
}

let remove = async (path: string) => {
  try {
    await Deno.remove(path, { recursive: true })
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}

let clean = async (root: string) => {
  for await (let item of Deno.readDir(root)) {
    if (!item.name.startsWith('run-') || !item.isDirectory || item.isSymlink) {
      continue
    }
    await remove(join(root, item.name))
  }
}

let copy = async (from: string, to: string) => {
  let stat = await exists(from)
  if (!stat) return false
  if (!stat.isFile || stat.isSymlink) throw unavailable()
  await Deno.copyFile(from, to)
  await Deno.chmod(to, 0o600)
  return true
}

// Codex's file store truncates auth.json in place. The staging directory
// keeps that private; only a complete, synced blob is renamed into the stable
// name that another tasksd generation may inherit.
export let codexStore = (root = codexHome()): AuthStore => ({
  begin: async () => {
    if (!root) throw unavailable()
    let rootStat = await exists(root)
    if (rootStat && (!rootStat.isDirectory || rootStat.isSymlink)) {
      throw unavailable()
    }
    if (!rootStat) await Deno.mkdir(root, { recursive: true, mode: 0o700 })
    rootStat = await exists(root)
    if (!rootStat?.isDirectory || rootStat.isSymlink) throw unavailable()
    await Deno.chmod(root, 0o700)
    let lock = await Deno.open(join(root, 'lock'), {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    })
    await Deno.chmod(join(root, 'lock'), 0o600)
    try {
      await lock.lock(true)
    } catch {
      lock.close()
      throw unavailable()
    }
    let home = join(root, `run-${crypto.randomUUID()}`)
    let stable = join(root, 'auth.json')
    let staged = join(home, 'auth.json')
    let closed = false
    try {
      await clean(root)
      await Deno.mkdir(home, { mode: 0o700 })
      await Deno.writeTextFile(
        join(home, 'config.toml'),
        'cli_auth_credentials_store = "file"\n',
        { createNew: true, mode: 0o600 },
      )
      await copy(stable, staged)
    } catch {
      await remove(home).catch(() => {})
      await lock.unlock().catch(() => {})
      lock.close()
      throw unavailable()
    }
    let close = async () => {
      if (closed) return
      closed = true
      await remove(home).catch(() => {})
      await lock.unlock().catch(() => {})
      lock.close()
    }
    let commit = async () => {
      let stat = await exists(staged)
      if (!stat) {
        let old = await exists(stable)
        if (!old) return
        if (!old.isFile || old.isSymlink) throw unavailable()
        await Deno.remove(stable)
        return
      }
      if (!stat.isFile || stat.isSymlink) throw unavailable()
      await Deno.chmod(staged, 0o600)
      using file = await Deno.open(staged, { read: true, write: true })
      await file.sync()
      await Deno.rename(staged, stable)
    }
    return { home, commit, close }
  },
})

// Milestone probes may import the native cache into a disposable account
// root once. This is deliberately not a default migration: two persistent
// copies would race one refresh-token lineage.
export let bootstrapCodexAuth = async (
  root: string,
  source = nativeCodexAuth(),
) => {
  if (!source) throw unavailable()
  let stored = await codexStore(root).begin()
  try {
    let target = join(stored.home, 'auth.json')
    if (await exists(target)) return false
    if (!await copy(source, target)) throw unavailable()
    await stored.commit()
    return true
  } catch {
    throw unavailable()
  } finally {
    await stored.close().catch(() => {})
  }
}

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let appEnv = (home: string, env: Env) => {
  let out: Record<string, string> = {
    CODEX_HOME: home,
    PATH: env('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
  }
  for (let name of ['CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE']) {
    let value = env(name)
    if (value) out[name] = value
  }
  return out
}

export let codexEnv = (
  home: string,
  env: Env = (name) => Deno.env.get(name),
) => appEnv(home, env)

let discard = async (stream: ReadableStream<Uint8Array>) => {
  for await (let _ of stream) { /* provider diagnostics never become ours */ }
}

type Pending = ReturnType<typeof Promise.withResolvers<Record<string, unknown>>>

export type CodexIssuerOptions = {
  command?: string
  timeout?: number
  env?: Env
}

export let codexIssuer = (
  options: CodexIssuerOptions = {},
): Issuer => ({
  open: async (home) => {
    let env = options.env ?? ((name: string) => Deno.env.get(name))
    let child: Deno.ChildProcess
    try {
      child = new Deno.Command(
        options.command ?? env('TASKS_CODEX_BIN') ?? 'codex',
        {
          args: ['app-server'],
          clearEnv: true,
          env: appEnv(home, env),
          stdin: 'piped',
          stdout: 'piped',
          stderr: 'piped',
        },
      ).spawn()
    } catch {
      throw unavailable()
    }
    let writer = child.stdin.getWriter()
    let calls = new Map<number, Pending>()
    let notes = new Map<string, Record<string, unknown>[]>()
    let waits = new Map<string, Pending[]>()
    let next = 0
    let closed = false
    let why = unavailable()
    let fail = () => {
      for (let pending of calls.values()) pending.reject(why)
      for (let list of waits.values()) {
        for (let pending of list) pending.reject(why)
      }
      calls.clear()
      waits.clear()
    }
    let land = (value: unknown) => {
      if (!record(value)) return
      if (typeof value.id == 'number') {
        let pending = calls.get(value.id)
        if (!pending) return
        calls.delete(value.id)
        if (value.error || !record(value.result)) pending.reject(why)
        else pending.resolve(value.result)
        return
      }
      if (typeof value.method != 'string' || !record(value.params)) return
      let waiting = waits.get(value.method)?.shift()
      if (waiting) waiting.resolve(value.params)
      else {
        let queue = notes.get(value.method) ?? []
        queue.push(value.params)
        notes.set(value.method, queue)
      }
    }
    let reader = (async () => {
      let decoder = new TextDecoder()
      let pending = ''
      try {
        for await (let bytes of child.stdout) {
          pending += decoder.decode(bytes, { stream: true })
          if (pending.length > 1024 * 1024) throw why
          let lines = pending.split('\n')
          pending = lines.pop() ?? ''
          for (let line of lines) {
            if (!line.trim()) continue
            let value: unknown
            try {
              value = JSON.parse(line)
            } catch {
              throw why
            }
            land(value)
          }
        }
      } catch { /* callers receive only the fixed boundary failure */ }
      fail()
    })()
    let errors = discard(child.stderr)
    let send = async (value: unknown) => {
      if (closed) throw why
      try {
        await writer.write(
          new TextEncoder().encode(`${JSON.stringify(value)}\n`),
        )
      } catch {
        throw why
      }
    }
    let call = async (
      method: string,
      params: Record<string, unknown> = {},
    ) => {
      let id = ++next
      let pending = Promise.withResolvers<Record<string, unknown>>()
      calls.set(id, pending)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await send({ method, id, params })
        return await Promise.race([
          pending.promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(why),
              Math.max(100, options.timeout ?? 30_000),
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
        calls.delete(id)
      }
    }
    let notify = (method: string, params: Record<string, unknown> = {}) =>
      send({ method, params })
    let wait = (method: string) => {
      let queued = notes.get(method)?.shift()
      if (queued) return Promise.resolve(queued)
      let pending = Promise.withResolvers<Record<string, unknown>>()
      let list = waits.get(method) ?? []
      list.push(pending)
      waits.set(method, list)
      return pending.promise
    }
    let close = async () => {
      if (closed) return
      closed = true
      fail()
      await writer.close().catch(() => {})
      try {
        child.kill('SIGTERM')
      } catch { /* it already exited */ }
      await Promise.allSettled([child.status, reader, errors])
    }
    try {
      await call('initialize', {
        clientInfo: { name: 'tasks', title: 'Tasks', version: '0.1.0' },
      })
      await notify('initialized')
      return { call, notify, wait, close }
    } catch {
      await close()
      throw why
    }
  },
})
