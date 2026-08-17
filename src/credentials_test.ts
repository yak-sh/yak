// The server-only credential store: local + environment backends, the
// catalog-keyed HTTP surface, and — the load-bearing property — that a secret
// canary never leaves through status, a response body, a diagnostic, or the
// graph. Secrets live in a temp state dir here, never the owner's.
Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot } = await import('./db.ts')
let { credentialHttp, credentialService } = await import('./credentials.ts')
let { assertEquals, assertStringIncludes } = await import('@std/assert')
let { bareDb } = await import('./testdb.ts')

bareDb()
let uid = () => crypto.randomUUID()
// The one string that must never surface anywhere but a server-only read.
let CANARY = 'sk-canary-DO-NOT-LEAK-9f8e7d6c'
let KEY = 'OLLAMA_API_KEY'

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
