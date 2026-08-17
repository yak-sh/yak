// Server-only credentials: the secret plane of the configuration catalog
// (config.ts). Secret bytes never become a graph component and never cross the
// wire — this module owns no graph handle, and its HTTP surface returns only
// STATE (configured / missing / unavailable), a source, and a scrubbed
// diagnostic, never a value or a reference. A write is one-way: nothing echoes
// or prefills the input.
//
// Two backends resolve a catalog secret key. An explicit LOCAL secret — the OSS
// default — is stored as plaintext in one atomically-replaced, server-only file
// under the Tasks state directory (root 0700, file 0600, no symlinks), the same
// threat model as the Codex credential store (codex_auth.ts). A read-only
// ENVIRONMENT fallback keeps existing deployments working. A local secret
// overrides the environment; deleting it reveals the environment again. Deleting
// a local secret overwrites this application's reference to it but cannot promise
// forensic erasure from the filesystem, snapshots, or host backups — see
// docs/CONFIGURATION.md.
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
export type CredSource = 'local' | 'environment' | null

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
  reset: (key: string) => Promise<CredStatus>
  test: (key: string) => Promise<CredStatus>
  // Server-only: the plaintext for a provider edge (local over environment).
  // Never reachable through credentialHttp. undefined = not configured.
  secret: (key: string) => Promise<string | undefined>
}

type Env = (name: string) => string | undefined

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

// The whole secret map, as stored. A missing file is an empty store; a symlink
// anywhere on the path, or a non-file / non-directory, is refused rather than
// followed — the store must be exactly the server-owned files it created.
let readLocal = async (
  root: string,
): Promise<Record<string, string>> => {
  let dir = await lstat(root)
  if (dir) {
    if (dir.isSymlink || !dir.isDirectory) throw unavailable()
  } else {
    return {}
  }
  let file = join(root, 'secrets.json')
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
): Promise<void> => {
  let dir = await lstat(root)
  if (dir && (dir.isSymlink || !dir.isDirectory)) throw unavailable()
  if (!dir) await Deno.mkdir(root, { recursive: true, mode: 0o700 })
  await Deno.chmod(root, 0o700)
  let file = join(root, 'secrets.json')
  let existing = await lstat(file)
  if (existing && (existing.isSymlink || !existing.isFile)) throw unavailable()
  let temp = join(root, `secrets.json.${crypto.randomUUID()}.tmp`)
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
): Credentials => {
  // The local read, tolerant of an unavailable store: status still reports the
  // environment (or unavailable) rather than throwing.
  let local = async (): Promise<
    { map?: Record<string, string>; detail?: string }
  > => {
    if (!root) return { detail: 'No Tasks state directory is configured.' }
    try {
      return { map: await readLocal(root) }
    } catch (error) {
      return { detail: codexMessage((error as Error).message) ?? 'unavailable' }
    }
  }

  let stateOf = async (key: string): Promise<CredStatus> => {
    let { map, detail } = await local()
    if (map && key in map && map[key] != '') {
      return { key, state: 'configured', source: 'local' }
    }
    let fromEnv = env(key)
    if (fromEnv != null && fromEnv.trim() != '') {
      return { key, state: 'configured', source: 'environment' }
    }
    // A missing local file is a legitimate "not configured"; only a broken
    // store (symlink, unreadable) reports unavailable with its scrubbed reason.
    if (!map) {
      return {
        key,
        state: 'unavailable',
        source: null,
        ...(detail ? { detail } : {}),
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
      let map = await readLocal(root)
      if (key in map && map[key] != '') return map[key]
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
    let map = await readLocal(root)
    map[key] = value
    await writeLocal(root, map)
    // Never echo the value — only the new state.
    return await stateOf(key)
  }

  let reset = async (key: string) => {
    secretKey(key)
    if (!root) throw unavailable('No Tasks state directory is configured.')
    let map = await readLocal(root)
    if (key in map) {
      delete map[key]
      await writeLocal(root, map)
    }
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

  return { status, list, write, reset, test, secret }
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
//   POST /config/credentials/<key>      { value } → store a local secret
//   POST /config/credentials/<key>/reset         → delete the local secret
//   POST /config/credentials/<key>/test          → provider-safe probe
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
      /^\/config\/credentials\/([^/]+)(?:\/(reset|test))?$/,
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
    if (action == 'test') return json(await service.test(key))
    let value = await body(req)
    if (typeof value.value != 'string' || Object.keys(value).length != 1) {
      throw fault('invalid_request', 'Send { "value": "…" }.', 400)
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
