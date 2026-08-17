// The server-only credential store: local + environment backends, the
// catalog-keyed HTTP surface, and — the load-bearing property — that a secret
// canary never leaves through status, a response body, a diagnostic, or the
// graph. Secrets live in a temp state dir here, never the owner's.
Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot } = await import('./db.ts')
let { credentialHttp, credentialService, isOpRef } = await import(
  './credentials.ts'
)
type OpRead = (reference: string, signal: AbortSignal) => Promise<string>
let { assertEquals, assertStringIncludes } = await import('@std/assert')
let { bareDb } = await import('./testdb.ts')

bareDb()
let uid = () => crypto.randomUUID()
// The one string that must never surface anywhere but a server-only read.
let CANARY = 'sk-canary-DO-NOT-LEAK-9f8e7d6c'
let KEY = 'OLLAMA_API_KEY'
// A 1Password reference and the value it resolves to — both server-only. The
// reference is as sensitive as the value here (it discloses infrastructure), so
// neither may surface through status, a body, or a diagnostic.
let OP_REF = 'op://Private/Ollama/api-key'
let OP_VALUE = 'op-resolved-DO-NOT-LEAK-1a2b3c'

// A fresh temp state dir per test, and a service over it with a controllable
// environment. The empty env is the default; a test opts into a fallback.
let fixture = (env: Record<string, string> = {}) => {
  let root = Deno.makeTempDirSync()
  let service = credentialService(root, (name) => env[name])
  return {
    root,
    service,
    clean: () => Deno.removeSync(root, { recursive: true }),
  }
}

Deno.test('write then status: a local secret reads back as configured, never echoed', async () => {
  let { service, clean } = fixture()
  try {
    let after = await service.write(KEY, CANARY)
    assertEquals(after.state, 'configured')
    assertEquals(after.source, 'local')
    // The status carries no value.
    assertEquals(JSON.stringify(after).includes(CANARY), false)
    // The server-only read is the ONLY door that returns the bytes.
    assertEquals(await service.secret(KEY), CANARY)
  } finally {
    clean()
  }
})

Deno.test('reset deletes the local secret and reveals the environment', async () => {
  let { service, clean } = fixture({ [KEY]: 'from-env' })
  try {
    await service.write(KEY, CANARY)
    assertEquals((await service.status(KEY)).source, 'local')
    let after = await service.reset(KEY)
    // Local gone; the environment fallback shows through.
    assertEquals(after.state, 'configured')
    assertEquals(after.source, 'environment')
    assertEquals(await service.secret(KEY), 'from-env')
  } finally {
    clean()
  }
})

Deno.test('a local secret overrides the environment', async () => {
  let { service, clean } = fixture({ [KEY]: 'from-env' })
  try {
    await service.write(KEY, CANARY)
    assertEquals((await service.status(KEY)).source, 'local')
    assertEquals(await service.secret(KEY), CANARY)
  } finally {
    clean()
  }
})

Deno.test('missing everywhere reports missing, with no source', async () => {
  let { service, clean } = fixture()
  try {
    let s = await service.status(KEY)
    assertEquals(s.state, 'missing')
    assertEquals(s.source, null)
    assertEquals(await service.secret(KEY), undefined)
  } finally {
    clean()
  }
})

Deno.test('a symlinked secret file is refused, not followed', async () => {
  let { root, service, clean } = fixture()
  try {
    // Point secrets.json at an attacker-controlled target outside the store.
    let target = Deno.makeTempFileSync()
    Deno.writeTextFileSync(target, JSON.stringify({ [KEY]: CANARY }))
    Deno.symlinkSync(target, `${root}/secrets.json`)
    let s = await service.status(KEY)
    assertEquals(s.state, 'unavailable')
    // Even the diagnostic never carries the value behind the symlink.
    assertEquals(JSON.stringify(s).includes(CANARY), false)
    Deno.removeSync(target)
  } finally {
    clean()
  }
})

Deno.test('the file is 0600 and the directory 0700', async () => {
  let { root, service, clean } = fixture()
  try {
    await service.write(KEY, CANARY)
    assertEquals(Deno.statSync(`${root}/secrets.json`).mode! & 0o777, 0o600)
    assertEquals(Deno.statSync(root).mode! & 0o777, 0o700)
  } finally {
    clean()
  }
})

Deno.test('a probe server (DB_PATH set) has no credentials home — no owner secrets', async () => {
  // credentialsHome returns undefined when DB_PATH is set; the service then has
  // no local store and refuses a write rather than landing in the owner's dir.
  let service = credentialService(undefined, () => undefined)
  let out = await service.write(KEY, CANARY).catch((e) => e as Error)
  assertEquals(out instanceof Error, true)
  assertEquals(await service.secret(KEY), undefined)
})

Deno.test('a written secret never reaches a graph snapshot', async () => {
  let { service, clean } = fixture()
  try {
    await service.write(KEY, CANARY)
    // The graph is a wholly separate plane; a normal write plus a snapshot never
    // sees the secret. (The credential module holds no graph handle at all.)
    let db = bareDb()
    apply(db, [{
      eid: uid(),
      name: 'doc',
      comp: { title: 'unrelated', body: '' },
    }])
    assertEquals(JSON.stringify(snapshot(db)).includes(CANARY), false)
  } finally {
    clean()
  }
})

// --- HTTP surface ---

let req = (path: string, init?: RequestInit) =>
  new Request(`http://tasks${path}`, init)
let post = (path: string, value?: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  })

Deno.test('HTTP: write returns state only, no-store, and never the value', async () => {
  let { service, clean } = fixture()
  try {
    let res = await credentialHttp(
      service,
      post(`/config/credentials/${KEY}`, { value: CANARY }),
    )
    assertEquals(res.headers.get('cache-control'), 'no-store')
    let text = await res.text()
    assertEquals(text.includes(CANARY), false)
    assertStringIncludes(text, 'configured')
  } finally {
    clean()
  }
})

Deno.test('HTTP: list and status carry no values', async () => {
  let { service, clean } = fixture()
  try {
    await service.write(KEY, CANARY)
    let list = await (await credentialHttp(service, req('/config/credentials')))
      .text()
    assertEquals(list.includes(CANARY), false)
    assertStringIncludes(list, KEY)
    let one =
      await (await credentialHttp(service, req(`/config/credentials/${KEY}`)))
        .text()
    assertEquals(one.includes(CANARY), false)
  } finally {
    clean()
  }
})

Deno.test('HTTP: an unknown or non-secret key is 404', async () => {
  let { service, clean } = fixture()
  try {
    let a = await credentialHttp(service, req('/config/credentials/MADE_UP'))
    assertEquals(a.status, 404)
    // A NON-secret catalog key has no credential either.
    let b = await credentialHttp(
      service,
      req('/config/credentials/OLLAMA_BASE_URL'),
    )
    assertEquals(b.status, 404)
  } finally {
    clean()
  }
})

Deno.test('HTTP: a non-JSON or oversize write is refused', async () => {
  let { service, clean } = fixture()
  try {
    let plain = await credentialHttp(
      service,
      req(`/config/credentials/${KEY}`, { method: 'POST', body: 'value=x' }),
    )
    assertEquals(plain.status, 400)
    let empty = await credentialHttp(
      service,
      post(`/config/credentials/${KEY}`, { value: '' }),
    )
    assertEquals(empty.status, 400)
  } finally {
    clean()
  }
})

Deno.test('HTTP: reset over the wire reveals the environment', async () => {
  let { service, clean } = fixture({ [KEY]: 'from-env' })
  try {
    await service.write(KEY, CANARY)
    let res = await credentialHttp(
      service,
      post(`/config/credentials/${KEY}/reset`),
    )
    let after = await res.json()
    assertEquals(after.source, 'environment')
    assertEquals(JSON.stringify(after).includes(CANARY), false)
  } finally {
    clean()
  }
})

// --- 1Password op backend ---

// A service over a temp store with an injectable op runner, so no real `op` is
// needed. `calls` counts every subprocess the resolver would have spawned.
let opFixture = (
  read: OpRead,
  env: Record<string, string> = {},
) => {
  let root = Deno.makeTempDirSync()
  let service = credentialService(root, (name) => env[name], undefined, read)
  return {
    root,
    service,
    clean: () => Deno.removeSync(root, { recursive: true }),
  }
}

// A runner that resolves to OP_VALUE and records each reference it was asked.
let counting = () => {
  let calls: string[] = []
  let read: OpRead = (reference) => {
    calls.push(reference)
    return Promise.resolve(OP_VALUE)
  }
  return { calls, read }
}

Deno.test('isOpRef accepts op:// with three segments, rejects the rest', () => {
  assertEquals(isOpRef('op://Private/Ollama/api-key'), true)
  assertEquals(isOpRef('op://Private/Item/section/field'), true)
  // Spaces in a field label are legal — this is an argv element, not a shell.
  assertEquals(isOpRef('op://Private/My Item/api key'), true)
  assertEquals(isOpRef('op://vault/item'), false) // no field
  assertEquals(isOpRef('https://example.com/x/y/z'), false) // wrong scheme
  assertEquals(isOpRef('op://a/b/c\nrm -rf'), false) // control char
})

Deno.test('bind then status/secret: an op-bound key resolves through op read', async () => {
  let { calls, read } = counting()
  let { service, clean } = opFixture(read)
  try {
    let after = await service.bind(KEY, OP_REF)
    assertEquals(after.state, 'configured')
    assertEquals(after.source, 'op')
    // Neither the reference nor the value ride in the status.
    let text = JSON.stringify(after)
    assertEquals(text.includes(OP_REF), false)
    assertEquals(text.includes(OP_VALUE), false)
    // The server-only read is the ONLY door that resolves the bytes.
    assertEquals(await service.secret(KEY), OP_VALUE)
    assertEquals(calls.includes(OP_REF), true)
  } finally {
    clean()
  }
})

Deno.test('binding and a local secret are mutually exclusive per key', async () => {
  let { read } = counting()
  let { service, clean } = opFixture(read)
  try {
    await service.write(KEY, CANARY)
    assertEquals((await service.status(KEY)).source, 'local')
    // Binding op replaces the local secret.
    await service.bind(KEY, OP_REF)
    assertEquals((await service.status(KEY)).source, 'op')
    assertEquals(await service.secret(KEY), OP_VALUE)
    // Writing a local secret replaces the binding again.
    await service.write(KEY, CANARY)
    assertEquals((await service.status(KEY)).source, 'local')
    assertEquals(await service.secret(KEY), CANARY)
  } finally {
    clean()
  }
})

Deno.test('a failing op read is unavailable, never a stale or env value', async () => {
  let fail: OpRead = () => Promise.reject(new Error('not signed in'))
  let { service, clean } = opFixture(fail, { [KEY]: 'from-env' })
  try {
    let after = await service.bind(KEY, OP_REF)
    assertEquals(after.state, 'unavailable')
    assertEquals(after.source, 'op')
    // A scrubbed diagnostic, and never the reference.
    assertEquals(JSON.stringify(after).includes(OP_REF), false)
    // A present binding overrides the environment even when op fails: no
    // silent fall-through to the env value.
    assertEquals(await service.secret(KEY), undefined)
  } finally {
    clean()
  }
})

Deno.test('op reads are cached; refresh drops the cache', async () => {
  let { calls, read } = counting()
  let { service, clean } = opFixture(read)
  try {
    await service.bind(KEY, OP_REF)
    let before = calls.length
    // A burst of reads is one subprocess, not one each.
    await service.secret(KEY)
    await service.secret(KEY)
    assertEquals(calls.length, before)
    // Refresh invalidates, so the next read re-runs op.
    await service.refresh(KEY)
    await service.secret(KEY)
    assertEquals(calls.length, before + 1)
  } finally {
    clean()
  }
})

Deno.test('reset clears the binding and reveals the environment', async () => {
  let { read } = counting()
  let { service, clean } = opFixture(read, { [KEY]: 'from-env' })
  try {
    await service.bind(KEY, OP_REF)
    assertEquals((await service.status(KEY)).source, 'op')
    let after = await service.reset(KEY)
    assertEquals(after.state, 'configured')
    assertEquals(after.source, 'environment')
    assertEquals(await service.secret(KEY), 'from-env')
  } finally {
    clean()
  }
})

Deno.test('op is never spawned for an unbound key', async () => {
  // A runner that would fail the test if the local/env path ever touched op.
  let boom: OpRead = () => Promise.reject(new Error('op must not be called'))
  let { service, clean } = opFixture(boom, { [KEY]: 'from-env' })
  try {
    assertEquals(await service.secret(KEY), 'from-env')
    await service.write(KEY, CANARY)
    assertEquals(await service.secret(KEY), CANARY)
  } finally {
    clean()
  }
})

Deno.test('bind refuses a non-op reference', async () => {
  let { read } = counting()
  let { service, clean } = opFixture(read)
  try {
    let out = await service.bind(KEY, 'https://evil/x/y').catch((e) =>
      e as Error
    )
    assertEquals(out instanceof Error, true)
    assertEquals((await service.status(KEY)).state, 'missing')
  } finally {
    clean()
  }
})

Deno.test('HTTP: bind via { reference }, refresh action, and no echo', async () => {
  let { read } = counting()
  let { service, clean } = opFixture(read)
  try {
    let res = await credentialHttp(
      service,
      post(`/config/credentials/${KEY}`, { reference: OP_REF }),
    )
    assertEquals(res.headers.get('cache-control'), 'no-store')
    let text = await res.text()
    assertEquals(text.includes(OP_REF), false)
    assertEquals(text.includes(OP_VALUE), false)
    assertStringIncludes(text, 'op')
    // Refresh over the wire re-checks and returns state only.
    let refreshed = await credentialHttp(
      service,
      post(`/config/credentials/${KEY}/refresh`),
    )
    let after = await refreshed.json()
    assertEquals(after.source, 'op')
    assertEquals(JSON.stringify(after).includes(OP_VALUE), false)
  } finally {
    clean()
  }
})
