// Codex account storage tests hold the opaque-file, isolation, and locking
// boundary. They never need a provider credential or a network call.
import { assertEquals, assertRejects } from '@std/assert'
import { tick } from './testing.ts'
import {
  bootstrapCodexAuth,
  codexEnv,
  codexHome,
  codexMessage,
  codexStore,
  nativeCodexAuth,
} from './codex_auth.ts'

let env = (values: Record<string, string>) => (name: string) => values[name]

Deno.test('Codex diagnostics retain the cause and redact credential shapes', () => {
  let cases: [string, string[]][] = [
    [
      'https://localhost/auth/callback?code=url-secret#token',
      ['url-secret'],
    ],
    ['Bearer bearer-secret', ['bearer-secret']],
    ['Basic basic-secret', ['basic-secret']],
    ['token="token secret suffix"', ['token secret suffix']],
    ['"access_token":"short-secret"', ['short-secret']],
    ['"code":"short-secret"', ['short-secret']],
    ['state=state-secret', ['state-secret']],
    ['verifier=verifier-secret', ['verifier-secret']],
    ['api_key=sk-api-secret-value', ['sk-api-secret-value']],
    ['account_id=account-secret', ['account-secret']],
    ['550e8400-e29b-41d4-a716-446655440000', ['550e8400']],
    ['org-organization-secret', ['organization-secret']],
    [
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature-secret',
      ['eyJzdWIiOiJzZWNyZXQifQ'],
    ],
    ['\x1b]52;c;clipboard\x07', ['\x1b', '\x07']],
  ]
  for (let [input, secrets] of cases) {
    let clean = codexMessage(`workspace denied device login · ${input}`)!
    assertEquals(clean.includes('workspace denied device login'), true)
    for (let secret of secrets) assertEquals(clean.includes(secret), false)
    assertEquals(clean.length <= 240, true)
  }
})

Deno.test('Codex account roots stay outside scratch graphs and environments', () => {
  assertEquals(
    codexHome(env({ TASKS_CODEX_HOME: '/chosen', DB_PATH: '/scratch' })),
    '/chosen',
  )
  assertEquals(
    codexHome(env({ DB_PATH: '/scratch', HOME: '/owner' })),
    undefined,
  )
  assertEquals(
    codexHome(env({ XDG_STATE_HOME: '/state', HOME: '/owner' })),
    '/state/tasks/codex',
  )
  assertEquals(
    codexHome(env({ HOME: '/owner' })),
    '/owner/.local/state/tasks/codex',
  )
  assertEquals(
    nativeCodexAuth(env({ CODEX_HOME: '/native', HOME: '/owner' })),
    '/native/auth.json',
  )
  assertEquals(
    nativeCodexAuth(env({ HOME: '/owner' })),
    '/owner/.codex/auth.json',
  )

  assertEquals(
    codexEnv(
      '/account',
      env({
        PATH: '/bin',
        SSL_CERT_FILE: '/ca.pem',
        OPENAI_API_KEY: 'secret',
        TASKS_SESSION: 'session-secret',
      }),
    ),
    {
      CODEX_HOME: '/account',
      PATH: '/bin',
      SSL_CERT_FILE: '/ca.pem',
    },
  )
})

Deno.test('Codex probe bootstrap imports once without sharing a live store', async () => {
  let parent = await Deno.makeTempDir()
  try {
    let source = `${parent}/native-auth.json`
    let root = `${parent}/disposable`
    await Deno.writeTextFile(source, 'opaque-native')
    assertEquals(await bootstrapCodexAuth(root, source), true)
    assertEquals(await Deno.readTextFile(`${root}/auth.json`), 'opaque-native')

    await Deno.writeTextFile(source, 'rotated-native')
    assertEquals(await bootstrapCodexAuth(root, source), false)
    assertEquals(await Deno.readTextFile(`${root}/auth.json`), 'opaque-native')
  } finally {
    await Deno.remove(parent, { recursive: true })
  }
})

Deno.test('Codex account store refuses a symlink root', async () => {
  let parent = await Deno.makeTempDir()
  try {
    await Deno.mkdir(`${parent}/target`)
    await Deno.symlink(`${parent}/target`, `${parent}/account`)
    await assertRejects(
      () => codexStore(`${parent}/account`).begin(),
      Error,
      'codex account unavailable',
    )
  } finally {
    await Deno.remove(parent, { recursive: true })
  }
})

Deno.test('Codex account store atomically commits opaque files and rolls back', async () => {
  let root = await Deno.makeTempDir()
  try {
    let stable = `${root}/auth.json`
    await Deno.writeTextFile(stable, 'opaque-old', { mode: 0o644 })
    await Deno.mkdir(`${root}/run-stale`)
    let store = codexStore(root)

    let first = await store.begin()
    assertEquals(
      await Deno.readTextFile(`${first.home}/auth.json`),
      'opaque-old',
    )
    await assertRejects(
      () => Deno.stat(`${root}/run-stale`),
      Deno.errors.NotFound,
    )
    await Deno.writeTextFile(`${first.home}/auth.json`, 'opaque-new')
    await first.commit()
    await first.close()

    assertEquals(await Deno.readTextFile(stable), 'opaque-new')
    assertEquals((await Deno.stat(root)).mode! & 0o777, 0o700)
    assertEquals((await Deno.stat(stable)).mode! & 0o777, 0o600)
    assertEquals((await Deno.stat(`${root}/lock`)).mode! & 0o777, 0o600)

    let rolledBack = await store.begin()
    await Deno.writeTextFile(`${rolledBack.home}/auth.json`, 'discarded')
    await rolledBack.close()
    assertEquals(await Deno.readTextFile(stable), 'opaque-new')

    let removed = await store.begin()
    await Deno.remove(`${removed.home}/auth.json`)
    await removed.commit()
    await removed.close()
    await assertRejects(() => Deno.stat(stable), Deno.errors.NotFound)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('Codex account store serializes refresh rotation across callers', async () => {
  let root = await Deno.makeTempDir()
  try {
    let store = codexStore(root)
    let first = await store.begin()
    let opening = store.begin()
    // A yield, not a span: if begin() is serialized, opening stays pending
    // across one macrotask, so 'waiting' wins deterministically.
    let state = await Promise.race([
      opening.then(() => 'opened'),
      tick().then(() => 'waiting' as const),
    ])
    assertEquals(state, 'waiting')
    await first.close()
    let second = await opening
    await second.close()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
