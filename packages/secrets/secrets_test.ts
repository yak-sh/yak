// A secret through the graph: the value goes to the vault, the graph keeps the
// handle, and nothing that rolls back leaves anything behind.

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
  isHandle,
  type Local,
  peek,
  ramVault,
  records,
  reveal,
  sealed,
  secretEid,
  secrets,
  secretsDoc,
  SENTINEL,
  sentinel,
  sentinelOf,
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

Deno.test('a written value is kept in the vault and read back as its handle', async () => {
  let { g, vault } = setup()
  let out = await g.apply([sealed('MAIL_TOKEN', 'cf-token')])
  let held = await row(g, 'MAIL_TOKEN')
  assert(isHandle(held!.value))
  assertEquals((out[0].secret as Record<string, string>).value, held!.value)
  assertEquals(out[0].entity.eid, secretEid('MAIL_TOKEN'))
  assertEquals(await reveal(vault, 'MAIL_TOKEN'), 'cf-token')
  assertEquals(vault.read(secretEid('MAIL_TOKEN'))!.handle, held!.value)
})

Deno.test('a secret keeps its handle when its value changes, and writing the handle back changes nothing', async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one')])
  let first = (await row(g, 'A'))!.value
  await g.apply([sealed('A', first)])
  assertEquals(await reveal(vault, 'A'), 'one')
  await g.apply([sealed('A', 'two')])
  assertEquals((await row(g, 'A'))!.value, first)
  assertEquals(await reveal(vault, 'A'), 'two')
})

Deno.test('one value under two names is two handles', async () => {
  let { g } = setup()
  await g.apply([sealed('A', 'one'), sealed('B', 'one')])
  assertNotEquals((await row(g, 'A'))!.value, (await row(g, 'B'))!.value)
})

Deno.test('the sentinel is the handle hashed under the vault salt, and survives a rotation', async () => {
  let { g, vault } = setup()
  assertEquals(await sentinelOf(vault, 'A'), undefined)
  await g.apply([sealed('A', 'one')])
  let handle = (await row(g, 'A'))!.value
  let said = (await sentinelOf(vault, 'A'))!
  assert(said.startsWith(SENTINEL))
  assertEquals(said, await sentinel(await vault.salt(), handle))
  assertNotEquals(await sentinel(await ramVault().salt(), handle), said)
  await g.apply([sealed('A', 'two')])
  assertEquals(await sentinelOf(vault, 'A'), said)
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

Deno.test('a secret inside a call is its handle there too, and sealed when the call applies it', async () => {
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
  assertEquals(
    (await row(g, 'A'))!.value,
    (change.secret as Record<string, string>).value,
  )
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
  assert(isHandle((await row(g, 'count a'))!.value))
})
