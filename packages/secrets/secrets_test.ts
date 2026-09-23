// A secret through the graph: the value goes to the vault, the graph keeps the
// sentinel, and nothing that rolls back leaves anything behind.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from '@std/assert'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  fileVault,
  isSentinel,
  type Local,
  peek,
  ramVault,
  records,
  reveal,
  sealed,
  secretEid,
  secrets,
  secretsDoc,
  unsealed,
  warm,
} from './mod.ts'

// A `call` of our own, standing in for @yaks/tools': a component whose text
// carries a whole change as JSON.
let calls = {
  $defs: {
    call: {
      component: true,
      type: 'object',
      properties: { args: { type: 'string' } },
    },
  },
}

let setup = (vault: Local = ramVault()) => {
  let vocab = loadVocab([secretsDoc, calls])
  let g = graph({ storage: ram(vocab), vocab, plugins: [secrets(vault)] })
  return { g, vault }
}

let row = async (g: Graph, name: string) =>
  (await g.read(`.secret.name="${name}"`))[0]?.secret as
    | Record<string, string>
    | undefined

let none = { env: () => undefined }

Deno.test('a written value is kept in the vault and read back as its sentinel', async () => {
  let { g, vault } = setup()
  let out = await g.apply([sealed('MAIL_TOKEN', 'cf-token')])
  let held = await row(g, 'MAIL_TOKEN')
  assert(isSentinel(held!.value))
  assertEquals((out[0].secret as Record<string, string>).value, held!.value)
  assertEquals(out[0].entity.eid, secretEid('MAIL_TOKEN'))
  assertEquals(await reveal(vault, 'MAIL_TOKEN'), 'cf-token')
  assertEquals(vault.read(secretEid('MAIL_TOKEN'))!.sentinel, held!.value)
})

Deno.test('the same value is the same sentinel, and writing it back changes nothing', async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one')])
  let first = (await row(g, 'A'))!.value
  await g.apply([sealed('A', 'one')])
  assertEquals((await row(g, 'A'))!.value, first)
  await g.apply([sealed('A', first)])
  assertEquals(await reveal(vault, 'A'), 'one')
  await g.apply([sealed('A', 'two')])
  assertNotEquals((await row(g, 'A'))!.value, first)
  assertEquals(await reveal(vault, 'A'), 'two')
})

Deno.test('another vault salts the same value into another sentinel', async () => {
  let a = setup(), b = setup()
  await a.g.apply([sealed('A', 'one')])
  await b.g.apply([sealed('A', 'one')])
  assertNotEquals((await row(a.g, 'A'))!.value, (await row(b.g, 'A'))!.value)
})

Deno.test('deleting a secret, or its component, drops it from the vault', async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one'), sealed('B', 'two')])
  await g.apply([unsealed('A')])
  await g.apply([{ entity: { eid: secretEid('B') }, secret: null }])
  assertEquals(vault.all(), [])
  assertEquals(await reveal(vault, 'A', none), undefined)
})

Deno.test('a dry run seals nothing, and a refused change puts the vault back', async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one')])
  await g.apply([sealed('A', 'two'), sealed('B', 'three')], { check: true })
  assertEquals(await reveal(vault, 'A'), 'one')
  assertEquals(vault.read(secretEid('B')), undefined)
  await g.apply([unsealed('A')], { check: true })
  assertEquals(await reveal(vault, 'A'), 'one')
  await assertRejects(() =>
    Promise.resolve(g.apply([{
      ...sealed('A', 'two'),
      $was: { secret: { value: 'not what it holds' } },
    }]))
  )
  assertEquals(await reveal(vault, 'A'), 'one')
})

Deno.test('a secret inside a call is its sentinel there too, and sealed when the call applies it', async () => {
  let { g, vault } = setup()
  let [call] = await g.apply([{
    entity: { eid: 'c1' },
    call: { args: JSON.stringify({ change: [sealed('A', 'hidden')] }) },
  }])
  let args = (call.call as Record<string, string>).args
  assert(!args.includes('hidden'))
  let [change] = JSON.parse(args).change as Bundle[]
  await g.apply([change])
  assertEquals(await reveal(vault, 'A'), 'hidden')
})

Deno.test('a name resolves through the vault, then 1Password, then the environment', async () => {
  let { g, vault } = setup()
  let op = (ref: string) =>
    ref == 'op://v/item/key' ? Promise.resolve('from-op') : Promise.reject(
      new Error('no such item'),
    )
  let env = (name: string) => `env:${name}`
  assertEquals(await reveal(vault, 'A', { env }), 'env:A')
  await g.apply([sealed('A', 'op://v/item/key'), sealed('B', 'op://v/gone/x')])
  assertEquals(vault.read(secretEid('A'))!.op, 'op://v/item/key')
  assertEquals(await reveal(vault, 'A', { env, op }), 'from-op')
  // bound to 1Password and failing: missing, never the environment
  let warn = console.warn
  console.warn = () => {}
  try {
    assertEquals(await reveal(vault, 'B', { env, op }), undefined)
  } finally {
    console.warn = warn
  }
})

Deno.test('peek answers on the spot, with 1Password values warmed first', async () => {
  let { g, vault } = setup()
  let op = () => Promise.resolve('warm')
  await g.apply([sealed('A', 'plain'), sealed('B', 'op://v/item/warm')])
  assertEquals(peek(vault, 'A', none), 'plain')
  assertEquals(peek(vault, 'C', { env: () => 'env' }), 'env')
  await warm(vault, { op })
  assertEquals(peek(vault, 'B', { op }), 'warm')
})

Deno.test('records change under the lock and are written back through the graph', async () => {
  let { g, vault } = setup()
  let store = records<{ n?: number }>(g, vault, 'count ')
  assertEquals(await store.read('a'), undefined)
  await Promise.all(
    [1, 2, 3].map(() =>
      store.update('a', (r) => Promise.resolve(void (r.n = (r.n ?? 0) + 1)))
    ),
  )
  assertEquals(await store.read('a'), { n: 3 })
  assert(isSentinel((await row(g, 'count a'))!.value))
})

Deno.test('the file vault is private files, one per secret, and follows no symlink', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let vault = fileVault(`${dir}/secrets`)
    let { g } = setup(vault)
    await g.apply([sealed('A', 'one')])
    let eid = secretEid('A')
    assertEquals(await reveal(fileVault(`${dir}/secrets`), 'A'), 'one')
    assertEquals(Deno.statSync(`${dir}/secrets`).mode! & 0o777, 0o700)
    assertEquals(
      Deno.statSync(`${dir}/secrets/${eid}.json`).mode! & 0o777,
      0o600,
    )
    assertEquals(vault.all().map(([e]) => e), [eid])
    await g.apply([unsealed('A')])
    assertEquals(vault.all(), [])
    Deno.symlinkSync('/etc/hostname', `${dir}/secrets/${eid}.json`)
    assertEquals(
      await Promise.resolve().then(() => vault.read(eid)).catch(() =>
        'refused'
      ),
      'refused',
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
