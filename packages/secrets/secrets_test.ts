// A secret through the graph: the value goes to the vault once the write has
// committed, the graph keeps the handle, and nothing refused leaves anything
// behind.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { provisionalDoc } from '@yaks/effects'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools/vocab'
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
  sentinels,
  swap,
  unsealed,
  type Vault,
  warm,
} from './mod.ts'

// The graph a host builds: the plugin over one vault, writing what it says
// about a seal back through the graph, and reporting where the graph does. `call` is @yaks/tools', a component whose
// text carries a whole change as JSON, and so are `error`, `exception` and
// `content`, the words a failed seal is said in.
let setup = <V extends Vault = Local>(vault: V = ramVault() as V) => {
  let vocab = loadVocab([secretsDoc, provisionalDoc, toolsDoc])
  let reported: unknown[] = []
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }))],
    report: (e) => void reported.push(e),
  })
  return { g, vault, reported }
}

// A vault in memory whose seal fails with each error it is handed, in turn.
let failing = (...errors: Error[]) => {
  let vault = ramVault()
  let seal = vault.seal
  return {
    ...vault,
    seal: (eid: string, s: Parameters<typeof seal>[1]) => {
      let e = errors.shift()
      if (e) return Promise.reject(e)
      return seal(eid, s)
    },
  }
}

let transient = () =>
  Object.assign(new Error('Network connection lost.'), { retryable: true })

let row = async (g: Graph, name: string) =>
  (await g.read(`.secret.name="${name}"&*`))[0]?.secret as
    | Record<string, string>
    | undefined

let none = { env: () => undefined }

let whole = async (g: Graph, name: string) =>
  (await g.read(`.secret.name="${name}"&*`))[0] as Bundle | undefined

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

Deno.test('a swap replaces the sentinels it has values for, and nothing else', async () => {
  let a = await sentinel(new Uint8Array(32), 'yak_secret_a')
  let b = await sentinel(new Uint8Array(32), 'yak_secret_b')
  let text = `Bearer ${a}; ${b}x; ${SENTINEL}short; yak_secret_a`
  assertEquals(sentinels(text), [a, b])
  assertEquals(
    swap(text, new Map([[a, 'sk-live']])),
    `Bearer sk-live; ${b}x; ${SENTINEL}short; yak_secret_a`,
  )
})

Deno.test('deleting a secret, or its component, drops it from the vault', async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one'), sealed('B', 'two')])
  await g.apply([unsealed('A')])
  await g.apply([{ entity: { eid: secretEid('B') }, secret: null }])
  assertEquals(vault.all(), [])
  assertEquals(await reveal(vault, 'A', none), undefined)
})

Deno.test('a dry run seals nothing, and neither does a refused change', async () => {
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

Deno.test('the writer waits for the seal; a reader in between sees the mark', async () => {
  let open = Promise.withResolvers<void>()
  let base = ramVault()
  let { g } = setup({
    ...base,
    seal: async (eid, s) => {
      await open.promise
      base.seal(eid, s)
    },
  })
  let writing = g.apply([sealed('A', 'one')])
  // Committed, and waiting on the vault.
  await new Promise((go) => setTimeout(go))
  let between = await whole(g, 'A')
  assertEquals(between!.provisional, { note: 'saving the key' })
  open.resolve()
  let [out] = await writing
  assert(isHandle((out.secret as Record<string, string>).value))
  assertEquals((await whole(g, 'A'))!.provisional, undefined)
  assertEquals(await reveal(base, 'A'), 'one')
})

Deno.test('a failure the vault calls retryable is an error, tried again until it seals', async () => {
  using time = new FakeTime()
  let { g, vault, reported } = setup(failing(transient()))
  let writing = g.apply([sealed('A', 'one')])
  await time.runMicrotasks()
  let said = (await whole(g, 'A'))!
  assertEquals(said.error, { code: 'transient' })
  assert(String((said.content as Record<string, string>).body).includes('lost'))
  await time.tickAsync(2_000)
  await writing
  let now = (await whole(g, 'A'))!
  assertEquals([now.provisional, now.error, now.content], [
    undefined,
    undefined,
    undefined,
  ])
  assertEquals(await reveal(vault, 'A'), 'one')
  assertEquals(reported, [])
})

Deno.test('any other failure is an exception, reported, and the value is gone', async () => {
  let { g, vault, reported } = setup(failing(new Error('no such table')))
  await g.apply([sealed('A', 'one')])
  let said = (await whole(g, 'A'))!
  assertEquals([said.provisional, said.error], [undefined, undefined])
  assertEquals(said.exception, {})
  assert(
    String((said.content as Record<string, string>).body).includes('no such'),
  )
  assertEquals((reported[0] as Error).message, 'no such table')
  assertEquals(await reveal(vault, 'A', none), undefined)
  // Given again, it seals, and the failure is over.
  await g.apply([sealed('A', 'one')])
  let now = (await whole(g, 'A'))!
  assertEquals([now.exception, now.content], [undefined, undefined])
  assertEquals(await reveal(vault, 'A'), 'one')
})

Deno.test('a retryable failure that outlasts every try is both', async () => {
  using time = new FakeTime()
  let { g, reported } = setup(failing(...[1, 2, 3, 4, 5].map(transient)))
  let writing = g.apply([sealed('A', 'one')])
  for (let i = 0; i < 5; i++) await time.tickAsync(2_000)
  await writing
  let said = (await whole(g, 'A'))!
  assertEquals(said.provisional, undefined)
  assertEquals([said.error, said.exception], [{ code: 'transient' }, {}])
  assertEquals(reported.length, 1)
})

Deno.test('a secret inside a call is its handle there too, and sealed when the call applies it', async () => {
  let { g, vault } = setup()
  let [call] = await g.apply([{
    entity: { eid: 'c1' },
    call: { args: { change: [sealed('A', 'hidden')] } },
  }])
  let args = (call.call as Record<string, { change: Bundle[] }>).args
  assert(!JSON.stringify(args).includes('hidden'))
  let [change] = args.change
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
  await warm(vault, ['B'], { op })
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
