// Codex account storage tests hold the opaque-file, isolation, and locking
// boundary. They never need a provider credential or a network call.
import { assertEquals, assertRejects } from '@std/assert'
import {
  bootstrapCodexAuth,
  codexEnv,
  codexHome,
  codexStore,
  nativeCodexAuth,
} from './codex_auth.ts'

let env = (values: Record<string, string>) => (name: string) => values[name]

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
    let state = await Promise.race([
      opening.then(() => 'opened'),
      new Promise<'waiting'>((resolve) =>
        setTimeout(() => resolve('waiting'), 20)
      ),
    ])
    assertEquals(state, 'waiting')
    await first.close()
    let second = await opening
    await second.close()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
