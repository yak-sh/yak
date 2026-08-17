// Server-only credentials: the secret plane of the configuration catalog
// (config.ts). Secret bytes never become a graph component and never cross the
// wire — this module owns no graph handle, and its HTTP surface returns only
// STATE (configured / missing / unavailable), a source, and a scrubbed
// diagnostic, never a value or a reference. A write is one-way: nothing echoes
// or prefills the input.
//
// Three backends resolve a catalog secret key. An explicit LOCAL secret — the
// OSS default — is stored as plaintext in one atomically-replaced, server-only
// file under the Tasks state directory (root 0700, file 0600, no symlinks), the
// same threat model as the Codex credential store (codex_auth.ts). An optional
// 1PASSWORD binding stores only an `op://` reference (server-only, same file
// discipline) and resolves it at read time with `op read` — no shell, minimal
// environment, a deadline, bounded output — so the secret bytes never rest here
// (T-18306). A read-only ENVIRONMENT fallback keeps existing deployments
// working. An explicit local secret or op binding overrides the environment;
// removing it reveals the environment again. Deleting a local secret overwrites
// this application's reference to it but cannot promise forensic erasure from
// the filesystem, snapshots, or host backups — see docs/CONFIGURATION.md.
//
// A local secret and an op binding are mutually exclusive per key: writing one
// clears the other, so a secret row names exactly one active backend.
//
// Consumers (T-18303) call `secret(key)` at the HTTP edge, so a saved credential
// reaches the next provider request without a tasksd restart; the value never
// enters a Session, a prompt, a child environment, or a command line.
import { join } from 'node:path'
import { codexMessage } from './codex_auth.ts'
import { secretKeys, spec } from './config.ts'

// A read reports only which of these three it is.
export type CredState = 'configured' | 'missing' | 'unavailable'
// Where a configured secret came from, or null when nothing is configured.
// `op` is a 1Password binding resolved with `op read` at read time.
export type CredSource = 'local' | 'op' | 'environment' | null

export type CredStatus = {
  key: string
  state: CredState
  source: CredSource
  // A scrubbed, human diagnostic — never a value or a reference. Present when a
  // backend is unavailable or a test failed, absent otherwise.
  detail?: string
}

export type Credentials = {
  status: (key: string) => Promise<CredStatus>
  list: () => Promise<CredStatus[]>
  write: (key: string, value: string) => Promise<CredStatus>
  // Bind a key to a 1Password `op://` reference (replaces any local secret).
  bind: (key: string, reference: string) => Promise<CredStatus>
  reset: (key: string) => Promise<CredStatus>
  // Drop the op read cache so the next resolve re-reads 1Password immediately.
  refresh: (key: string) => Promise<CredStatus>
  test: (key: string) => Promise<CredStatus>
  // Server-only: the plaintext for a provider edge (local over op over
  // environment). Never reachable through credentialHttp. undefined = not
  // configured (an op binding that fails to resolve reads as undefined, never a
  // stale value).
  secret: (key: string) => Promise<string | undefined>
}

type Env = (name: string) => string | undefined

// Resolve an `op://` reference to its secret value. Injected so tests never
// need a real `op` binary; the default (opReadCli) spawns the CLI. Throws on
// any failure (not installed, not authenticated, no access, timeout); the caller
// turns that into an `unavailable` state with a scrubbed diagnostic.
export type OpRead = (reference: string, signal: AbortSignal) => Promise<string>

let dec = new TextDecoder()

// op is bounded on every axis it touches the daemon: a hard deadline so a hung
// CLI can't wedge a request, a brief cache so a burst of provider requests is
// one subprocess not N, and a capped read so a runaway value can't exhaust
// memory. The cache is short enough that a rotation in 1Password is picked up
// without a restart; save/reset/refresh drop it immediately.
let OP_DEADLINE_MS = 5000
let OP_CACHE_MS = 30_000
let OP_MAX_OUT = 65_536

// Accept ONLY an `op://vault/item/field` reference (a section segment may sit
// before the field). Field labels can contain spaces, so spaces are fine — this
// string is an argv element to `op read`, never a shell word — but any control
// character (newline, tab, NUL) is refused. Guards both the write (bind) and
// the read, so a tampered store can't smuggle a non-reference into the CLI.
export let isOpRef = (value: string): boolean => {
  if (!value.startsWith('op://')) return false
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  return value.slice(5).split('/').filter((s) => s.length > 0).length >= 3
}

// The minimal environment `op` may see: PATH to find the binary and its config,
// HOME for a personal pre-authenticated CLI's session, and
// OP_SERVICE_ACCOUNT_TOKEN for an unattended least-privilege daemon. Nothing
// else of the server's environment crosses into the subprocess.
let opEnv = (env: Env): Record<string, string> => {
  let out: Record<string, string> = {
    PATH: env('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
  }
  for (
    let name of ['HOME', 'XDG_CONFIG_HOME', 'OP_SERVICE_ACCOUNT_TOKEN']
  ) {
    let value = env(name)
    if (value) out[name] = value
  }
  return out
}

// Resolve a reference with `op read`: no shell, cleared environment save the
// allowlist, stdin closed so it never blocks on a prompt, bounded stdout, and a
// bounded stderr that stays out of the return. A non-zero exit or a missing
// binary throws; the caller scrubs and reports it, never a stale value.
export let opReadCli = (env: Env): OpRead => async (reference, signal) => {
  let cmd = new Deno.Command('op', {
    args: ['read', '--no-newline', reference],
    clearEnv: true,
    env: opEnv(env),
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    signal,
  })
  let out: Deno.CommandOutput
  try {
    out = await cmd.output()
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error('op is not installed or not on PATH.')
    }
    throw new Error((error as Error).message)
  }
  if (!out.success) {
    let err = dec.decode(out.stderr.slice(0, OP_MAX_OUT)).trim()
    throw new Error(err || 'op read failed.')
  }
  return dec.decode(out.stdout.slice(0, OP_MAX_OUT))
}

// A fault carrying an HTTP status, like accounts.ts — so the router answers a
// bad request with a code and a scrubbed message, never a raw stack.
type Fault = Error & { code: string; status: number }
let fault = (code: string, message: string, status: number): Fault =>
  Object.assign(new Error(message), { code, status })
let isFault = (value: unknown): value is Fault =>
  value instanceof Error &&
  typeof (value as Partial<Fault>).code == 'string' &&
  typeof (value as Partial<Fault>).status == 'number'

let unavailable = (detail?: string) =>
  fault(
    'store_unavailable',
    detail ?? 'The credential store is unavailable.',
    503,
  )

// Where the local secret file lives. Mirrors codex_auth's codexHome: an explicit
// root wins; a scratch/probe server (DB_PATH set) gets NONE, so a probe can
// never read or write the owner's secrets; otherwise the XDG state dir.
export let credentialsHome = (
  env: Env = (name) => Deno.env.get(name),
): string | undefined => {
  let chosen = env('TASKS_CREDENTIALS_DIR')
  if (chosen) return chosen
  if (env('DB_PATH')) return undefined
  let state = env('XDG_STATE_HOME')
  let home = env('HOME')
  return state
    ? `${state}/tasks/credentials`
    : home
    ? `${home}/.local/state/tasks/credentials`
    : undefined
}

let lstat = async (path: string) => {
  try {
    return await Deno.lstat(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null
    throw error
  }
}

// The whole map from one server-owned store file, as stored. A missing file is
// an empty store; a symlink anywhere on the path, or a non-file / non-directory,
// is refused rather than followed — the store must be exactly the server-owned
// files it created. `name` selects the plane: `secrets.json` holds plaintext
// values, `bindings.json` holds `op://` references — same discipline for both.
let readLocal = async (
  root: string,
  name = 'secrets.json',
): Promise<Record<string, string>> => {
  let dir = await lstat(root)
  if (dir) {
    if (dir.isSymlink || !dir.isDirectory) throw unavailable()
  } else {
    return {}
  }
  let file = join(root, name)
  let stat = await lstat(file)
  if (!stat) return {}
  if (stat.isSymlink || !stat.isFile) throw unavailable()
  let text: string
  try {
    text = await Deno.readTextFile(file)
  } catch {
    throw unavailable()
  }
  try {
    let value: unknown = JSON.parse(text)
    if (value == null || typeof value != 'object' || Array.isArray(value)) {
      throw unavailable()
    }
    let out: Record<string, string> = {}
    for (let [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v == 'string') out[k] = v
    }
    return out
  } catch (error) {
    if (isFault(error)) throw error
    throw unavailable()
  }
}

// Replace the whole store atomically: a temp file in the same directory, synced,
// 0600, renamed over the stable name. The directory is created 0700 and
// re-chmod'd each write, refusing a symlinked root — the codex_auth idiom.
let writeLocal = async (
  root: string,
  secrets: Record<string, string>,
  name = 'secrets.json',
): Promise<void> => {
  let dir = await lstat(root)
  if (dir && (dir.isSymlink || !dir.isDirectory)) throw unavailable()
  if (!dir) await Deno.mkdir(root, { recursive: true, mode: 0o700 })
  await Deno.chmod(root, 0o700)
  let file = join(root, name)
  let existing = await lstat(file)
  if (existing && (existing.isSymlink || !existing.isFile)) throw unavailable()
  let temp = join(root, `${name}.${crypto.randomUUID()}.tmp`)
  try {
    await Deno.writeTextFile(temp, JSON.stringify(secrets), {
      createNew: true,
      mode: 0o600,
    })
    await Deno.chmod(temp, 0o600)
    using handle = await Deno.open(temp, { read: true, write: true })
    await handle.sync()
    await Deno.rename(temp, file)
  } catch (error) {
    await Deno.remove(temp).catch(() => {})
    if (isFault(error)) throw error
    throw unavailable()
  }
}

// A catalog secret key, or a 404-shaped refusal. Guards every door: only a
// known SECRET setting has a credential, never a plain one.
let secretKey = (key: string) => {
  let s = spec(key)
  if (!s || !s.sensitive) {
    throw fault(
      'unknown_key',
      `No such credential ${JSON.stringify(key)}.`,
      404,
    )
  }
  return s
}

let MAX = 8192

export let credentialService = (
  root = credentialsHome(),
  env: Env = (name) => Deno.env.get(name),
  // A provider-safe probe, injected later (T-18303) to make `test` a real
  // readiness check. Provider-neutral by default: a configured secret passes.
  probe?: (key: string, secret: string | undefined) => Promise<void>,
  // Resolve an `op://` reference. Injected so tests need no real `op`; the
  // default spawns the CLI with the service's own environment allowlist.
  opRead: OpRead = opReadCli(env),
): Credentials => {
  // The one store read, tolerant of an unavailable store: status still reports
  // the environment (or unavailable) rather than throwing. `name` selects the
  // plane — secrets or op bindings.
  let readMap = async (
    name?: string,
  ): Promise<{ map?: Record<string, string>; detail?: string }> => {
    if (!root) return { detail: 'No Tasks state directory is configured.' }
    try {
      return { map: await readLocal(root, name) }
    } catch (error) {
      return { detail: codexMessage((error as Error).message) ?? 'unavailable' }
    }
  }
  let local = () => readMap('secrets.json')
  let bindings = () => readMap('bindings.json')

  // A brief, per-reference cache of resolved op values: a burst of provider
  // requests is one subprocess, not one each. Cleared whole on any mutation
  // (write/bind/reset/refresh) so a save is observed immediately; otherwise
  // entries expire, which is how a rotation in 1Password is picked up.
  let cache = new Map<string, { value: string; expires: number }>()

  // Resolve an op reference through the cache. Never returns a stale value: a
  // failed read drops any cache entry and reports a scrubbed diagnostic, so a
  // consumer sees "not configured", never yesterday's credential.
  let resolveOp = async (
    reference: string,
  ): Promise<{ value?: string; detail?: string }> => {
    if (!isOpRef(reference)) {
      return { detail: 'The stored reference is not an op:// reference.' }
    }
    let hit = cache.get(reference)
    if (hit && hit.expires > Date.now()) return { value: hit.value }
    try {
      let value = await opRead(reference, AbortSignal.timeout(OP_DEADLINE_MS))
      cache.set(reference, { value, expires: Date.now() + OP_CACHE_MS })
      return { value }
    } catch (error) {
      cache.delete(reference)
      return {
        detail: codexMessage((error as Error)?.message) ?? 'op read failed.',
      }
    }
  }

  // Precedence: a local plaintext secret, then an op binding, then the
  // environment. A present op binding overrides the environment even when it
  // fails to resolve — the operator chose 1Password, so a transient op failure
  // reports unavailable rather than silently falling back to a stale env value.
  let stateOf = async (key: string): Promise<CredStatus> => {
    let { map, detail } = await local()
    if (map && key in map && map[key] != '') {
      return { key, state: 'configured', source: 'local' }
    }
    let binds = await bindings()
    let reference = binds.map?.[key]
    if (reference) {
      let r = await resolveOp(reference)
      if (r.value != null && r.value != '') {
        return { key, state: 'configured', source: 'op' }
      }
      return {
        key,
        state: 'unavailable',
        source: 'op',
        ...(r.detail ? { detail: r.detail } : {}),
      }
    }
    let fromEnv = env(key)
    if (fromEnv != null && fromEnv.trim() != '') {
      return { key, state: 'configured', source: 'environment' }
    }
    // A missing store file is a legitimate "not configured"; only a broken
    // store (symlink, unreadable) reports unavailable with its scrubbed reason.
    if (!map) {
      return {
        key,
        state: 'unavailable',
        source: null,
        ...(detail ? { detail } : {}),
      }
    }
    if (!binds.map) {
      return {
        key,
        state: 'unavailable',
        source: null,
        ...(binds.detail ? { detail: binds.detail } : {}),
      }
    }
    return { key, state: 'missing', source: null }
  }

  let status = async (key: string) => {
    secretKey(key)
    return await stateOf(key)
  }

  let list = () => Promise.all(secretKeys.map((key) => stateOf(key)))

  let secret = async (key: string): Promise<string | undefined> => {
    secretKey(key)
    if (root) {
      let map = await readLocal(root, 'secrets.json')
      if (key in map && map[key] != '') return map[key]
      let reference = (await readLocal(root, 'bindings.json'))[key]
      if (reference) {
        // A binding overrides the environment: resolve op, or nothing — never a
        // stale value, and never a fall-through to env once op is chosen.
        let r = await resolveOp(reference)
        return r.value != null && r.value != '' ? r.value : undefined
      }
    }
    let fromEnv = env(key)?.trim()
    return fromEnv ? fromEnv : undefined
  }

  let write = async (key: string, value: string) => {
    secretKey(key)
    if (typeof value != 'string' || !value.trim() || value.length > MAX) {
      throw fault('invalid_value', 'Enter a non-empty credential.', 400)
    }
    if (!root) throw unavailable('No Tasks state directory is configured.')
    let map = await readLocal(root, 'secrets.json')
    map[key] = value
    await writeLocal(root, map, 'secrets.json')
    // Mutual exclusion: a local secret replaces any op binding for this key.
    let binds = await readLocal(root, 'bindings.json')
    if (key in binds) {
      delete binds[key]
      await writeLocal(root, binds, 'bindings.json')
    }
    cache.clear()
    // Never echo the value — only the new state.
    return await stateOf(key)
  }

  let bind = async (key: string, reference: string) => {
    secretKey(key)
    let ref = typeof reference == 'string' ? reference.trim() : ''
    if (!isOpRef(ref) || ref.length > MAX) {
      throw fault('invalid_value', 'Enter an op:// secret reference.', 400)
    }
    if (!root) throw unavailable('No Tasks state directory is configured.')
    let binds = await readLocal(root, 'bindings.json')
    binds[key] = ref
    await writeLocal(root, binds, 'bindings.json')
    // Mutual exclusion: an op binding replaces any local secret for this key.
    let map = await readLocal(root, 'secrets.json')
    if (key in map) {
      delete map[key]
      await writeLocal(root, map, 'secrets.json')
    }
    cache.clear()
    return await stateOf(key)
  }

  let reset = async (key: string) => {
    secretKey(key)
    if (!root) throw unavailable('No Tasks state directory is configured.')
    let map = await readLocal(root, 'secrets.json')
    if (key in map) {
      delete map[key]
      await writeLocal(root, map, 'secrets.json')
    }
    let binds = await readLocal(root, 'bindings.json')
    if (key in binds) {
      delete binds[key]
      await writeLocal(root, binds, 'bindings.json')
    }
    cache.clear()
    return await stateOf(key)
  }

  // Drop the op read cache so the next resolve re-reads 1Password. A save or
  // reset already does this; refresh is the explicit "re-check now" action for a
  // reference whose value rotated within the cache window.
  let refresh = async (key: string) => {
    secretKey(key)
    cache.clear()
    return await stateOf(key)
  }

  let test = async (key: string): Promise<CredStatus> => {
    secretKey(key)
    let state = await stateOf(key)
    if (state.state != 'configured') return state
    if (!probe) return state
    try {
      await probe(key, await secret(key))
      return state
    } catch (error) {
      return {
        key,
        state: 'unavailable',
        source: state.source,
        detail: codexMessage((error as Error).message) ?? 'The test failed.',
      }
    }
  }

  return { status, list, write, bind, reset, refresh, test, secret }
}

let headers = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
}

let json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers })

// A bounded JSON body, like accounts.ts: application/json only, capped so a
// runaway request can't exhaust memory.
let body = async (req: Request): Promise<Record<string, unknown>> => {
  if (
    req.headers.get('content-type')?.split(';')[0].trim() != 'application/json'
  ) throw fault('invalid_request', 'Send application/json.', 400)
  if (!req.body) throw fault('invalid_request', 'Send a JSON body.', 400)
  let reader = req.body.getReader()
  let decoder = new TextDecoder()
  let text = '', size = 0
  while (true) {
    let part = await reader.read()
    if (part.done) {
      text += decoder.decode()
      break
    }
    size += part.value.length
    if (size > MAX) {
      await reader.cancel().catch(() => {})
      throw fault('invalid_request', 'The request is too large.', 400)
    }
    text += decoder.decode(part.value, { stream: true })
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw fault('invalid_request', 'The body is not valid JSON.', 400)
  }
  if (value == null || typeof value != 'object' || Array.isArray(value)) {
    throw fault('invalid_request', 'The body must be a JSON object.', 400)
  }
  return value as Record<string, unknown>
}

// The server-only HTTP surface, mounted under /config/credentials. JSON-only,
// no-store, catalog-keyed. Never returns a value; a write consumes its input.
//
//   GET  /config/credentials            → every secret key's status
//   GET  /config/credentials/<key>      → one key's status
//   POST /config/credentials/<key>      { value }     → store a local secret
//   POST /config/credentials/<key>      { reference }  → bind a 1Password op://
//   POST /config/credentials/<key>/reset          → clear local + binding
//   POST /config/credentials/<key>/refresh        → drop the op read cache
//   POST /config/credentials/<key>/test           → provider-safe probe
export let credentialHttp = async (
  service: Credentials,
  req: Request,
  path = new URL(req.url).pathname,
): Promise<Response> => {
  try {
    if (path == '/config/credentials' && req.method == 'GET') {
      return json(await service.list())
    }
    let match = path.match(
      /^\/config\/credentials\/([^/]+)(?:\/(reset|refresh|test))?$/,
    )
    if (!match) return json({ error: { code: 'not_found' } }, 404)
    let key = decodeURIComponent(match[1])
    let action = match[2]
    if (req.method == 'GET') {
      if (action) return json({ error: { code: 'not_found' } }, 404)
      return json(await service.status(key))
    }
    if (req.method != 'POST') {
      return json({ error: { code: 'method_not_allowed' } }, 405)
    }
    if (action == 'reset') return json(await service.reset(key))
    if (action == 'refresh') return json(await service.refresh(key))
    if (action == 'test') return json(await service.test(key))
    let value = await body(req)
    // One field decides the backend: a plaintext value (local) or an op://
    // reference (1Password). Never both, never a value echoed back.
    if (typeof value.reference == 'string' && Object.keys(value).length == 1) {
      return json(await service.bind(key, value.reference))
    }
    if (typeof value.value != 'string' || Object.keys(value).length != 1) {
      throw fault(
        'invalid_request',
        'Send { "value": "…" } or { "reference": "op://…" }.',
        400,
      )
    }
    return json(await service.write(key, value.value))
  } catch (error) {
    let safe = isFault(error)
      ? error
      : unavailable(codexMessage((error as Error)?.message) ?? undefined)
    return json(
      { error: { code: safe.code, message: safe.message } },
      safe.status,
    )
  }
}
