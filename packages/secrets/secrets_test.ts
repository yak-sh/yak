import { docDoc } from '@yaks/doc'
// A secret through the graph: the value goes to the vault once the write has
// committed, the graph keeps the handle, and nothing refused leaves anything
// behind.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { provisionalDoc } from '@yaks/effects'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
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
// text carries a whole batch as JSON. `failed` records a terminal seal outcome;
// the original failure reaches the graph's reporter.
let vocab = loadVocab([secretsDoc, provisionalDoc, toolsDoc, docDoc, kernelDoc])
let setup = <V extends Vault = Local>(vault: V = ramVault() as V) => {
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

test('a written value is kept in the vault and read back as its handle', async () => {
  let { g, vault } = setup()
  let out = await g.apply([sealed('MAIL_TOKEN', 'cf-token')])
  let held = await row(g, 'MAIL_TOKEN')
  assert(isHandle(held!.value))
  assertEquals((out[0].secret as Record<string, string>).value, held!.value)
  assertEquals(out[0].entity.eid, secretEid('MAIL_TOKEN'))
  assertEquals(await reveal(vault, 'MAIL_TOKEN'), 'cf-token')
  assertEquals(vault.read(secretEid('MAIL_TOKEN'))!.handle, held!.value)
})

test('every secret in a batch seals with only secret and provisional vocabulary', async () => {
  let vocab = loadVocab([secretsDoc, provisionalDoc])
  let vault = ramVault()
  let reported: unknown[] = []
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }))],
    report: (e) => void reported.push(e),
  })
  await g.apply([sealed('A', 'one'), sealed('B', 'two')])
  assertEquals(await reveal(vault, 'A', none), 'one')
  assertEquals(await reveal(vault, 'B', none), 'two')
  assertEquals((await whole(g, 'A'))!.provisional, undefined)
  assertEquals((await whole(g, 'B'))!.provisional, undefined)
  assertEquals(reported, [])
})

test('a secret keeps its handle when its value changes, and writing the handle back changes nothing', async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one')])
  let first = (await row(g, 'A'))!.value
  await g.apply([sealed('A', first)])
  assertEquals(await reveal(vault, 'A'), 'one')
  await g.apply([sealed('A', 'two')])
  assertEquals((await row(g, 'A'))!.value, first)
  assertEquals(await reveal(vault, 'A'), 'two')
})

test('one value under two names is two handles', async () => {
  let { g } = setup()
  await g.apply([sealed('A', 'one'), sealed('B', 'one')])
  assertNotEquals((await row(g, 'A'))!.value, (await row(g, 'B'))!.value)
})

let platformSentinel = async (salt: Uint8Array, handle: string) => {
  let key = await crypto.subtle.importKey(
    'raw',
    salt as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(handle),
  )
  return SENTINEL + btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

let sentinelFixture = setup()
let missingSentinel = await sentinelOf(sentinelFixture.vault, 'A')
await sentinelFixture.g.apply([sealed('A', 'one')])
let sentinelHandle = (await row(sentinelFixture.g, 'A'))!.value
let expectedSentinel = await platformSentinel(
  await sentinelFixture.vault.salt(),
  sentinelHandle,
)
let otherSentinel = await sentinel(await ramVault().salt(), sentinelHandle)
let firstSentinel = (await sentinelOf(sentinelFixture.vault, 'A'))!
await sentinelFixture.g.apply([sealed('A', 'two')])
let rotatedSentinel = await sentinelOf(sentinelFixture.vault, 'A')
test('the sentinel is the handle hashed under the vault salt, and survives a rotation', () => {
  assertEquals(missingSentinel, undefined)
  assert(firstSentinel.startsWith(SENTINEL))
  assertEquals(firstSentinel, expectedSentinel)
  assertNotEquals(otherSentinel, firstSentinel)
  assertEquals(rotatedSentinel, firstSentinel)
})

let changingSalt = new Uint8Array(32)
let changingHandle = 'yak_secret_mutable_salt'
let beforeSaltChange = await sentinel(changingSalt, changingHandle)
let expectedBefore = await platformSentinel(changingSalt, changingHandle)
let nextSalt = changingSalt.slice()
nextSalt[0] = 1
let expectedAfter = await platformSentinel(nextSalt, changingHandle)
test('a sentinel follows changed salt bytes and matches the platform HMAC', async () => {
  assertEquals(beforeSaltChange, expectedBefore)
  changingSalt[0] = 1
  assertEquals(await sentinel(changingSalt, changingHandle), expectedAfter)
  assertEquals(await sentinel(changingSalt, changingHandle), expectedAfter)
})

test('a swap replaces the sentinels it has values for, and nothing else', async () => {
  let a = await sentinel(new Uint8Array(32), 'yak_secret_a')
  let b = await sentinel(new Uint8Array(32), 'yak_secret_b')
  let text = `Bearer ${a}; ${b}x; ${SENTINEL}short; yak_secret_a`
  assertEquals(sentinels(text), [a, b])
  assertEquals(
    swap(text, new Map([[a, 'sk-live']])),
    `Bearer sk-live; ${b}x; ${SENTINEL}short; yak_secret_a`,
  )
})

let deletingSecrets = await (async () => {
  let { g, vault } = setup()
  await g.apply([sealed('A', 'one'), sealed('B', 'two')])
  let a = await sentinelOf(vault, 'A'), b = await sentinelOf(vault, 'B')
  return { g, vault, a, b }
})()
test('deleting a secret, or its component, drops it from the vault', async () => {
  let { g, vault, a, b } = deletingSecrets
  assert(a)
  assert(b)
  await g.apply([unsealed('A')])
  await g.apply([{ entity: { eid: secretEid('B') }, secret: null }])
  assertEquals(vault.all(), [])
  assertEquals(await sentinelOf(vault, 'A'), undefined)
  assertEquals(await sentinelOf(vault, 'B'), undefined)
  assertEquals(await reveal(vault, 'A', none), undefined)
})

let rehearsed = setup()
await rehearsed.g.apply([sealed('A', 'one')])
await rehearsed.g.apply([sealed('A', 'two'), sealed('B', 'three')], {
  check: true,
})
let checkedValue = await reveal(rehearsed.vault, 'A')
let checkedNew = rehearsed.vault.read(secretEid('B'))
await rehearsed.g.apply([unsealed('A')], { check: true })
let checkedUnseal = await reveal(rehearsed.vault, 'A')
let refusedSeal = await Promise.resolve(rehearsed.g.apply([{
  ...sealed('A', 'two'),
  $was: { secret: { value: 'not what it holds' } },
}])).then(() => undefined, (error: unknown) => error)
let refusedValue = await reveal(rehearsed.vault, 'A')
test('a dry run seals nothing, and neither does a refused batch', () => {
  assertEquals(checkedValue, 'one')
  assertEquals(checkedNew, undefined)
  assertEquals(checkedUnseal, 'one')
  assert(refusedSeal instanceof Error)
  assertEquals(refusedValue, 'one')
})

test('the writer waits for the seal; a reader in between sees the mark', async () => {
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

test('a failure the vault calls retryable is provisional, tried again until it seals', async () => {
  using time = new FakeTime()
  let { g, vault, reported } = setup(failing(transient()))
  let writing = g.apply([sealed('A', 'one')])
  await time.runMicrotasks()
  let said = (await whole(g, 'A'))!
  assertEquals(said.provisional, { note: 'Saving the key, trying again' })
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

let terminalSeal = await (async () => {
  let { g, vault, reported } = setup(failing(new Error('no such table')))
  await g.apply([sealed('A', 'one')])
  let said = (await whole(g, 'A'))!
  let missing = await reveal(vault, 'A', none)
  await g.apply([sealed('A', 'one')])
  let now = (await whole(g, 'A'))!
  let value = await reveal(vault, 'A')
  return { said, now, missing, value, reported }
})()
test('a terminal seal failure records its outcome, reports once and can be retried', () => {
  let { said, now, missing, value, reported } = terminalSeal
  assertEquals([said.provisional, said.error], [undefined, undefined])
  assertEquals(said.exception, undefined)
  assertEquals(
    (said.failed as Record<string, unknown>).reason,
    'the key could not be saved: no such table',
  )
  assertEquals(said.content, undefined)
  assertEquals(reported.length, 1)
  assertEquals((reported[0] as Error).message, 'no such table')
  assertEquals(missing, undefined)
  // Given again, it seals, and the failure is over.
  assertEquals([now.failed, now.content], [undefined, undefined])
  assertEquals(value, 'one')
})

test('a retryable failure that outlasts every try is reported', async () => {
  using time = new FakeTime()
  let { g, reported } = setup(failing(...[1, 2, 3, 4, 5].map(transient)))
  let writing = g.apply([sealed('A', 'one')])
  for (let i = 0; i < 5; i++) await time.tickAsync(2_000)
  await writing
  let said = (await whole(g, 'A'))!
  assertEquals(said.provisional, undefined)
  assertEquals([said.error, said.exception], [undefined, undefined])
  assertEquals(
    (said.failed as Record<string, unknown>).reason,
    'the key could not be saved: Network connection lost.',
  )
  assertEquals(reported.length, 1)
})

test('a secret inside a call is its handle there too, and sealed when the call applies it', async () => {
  let { g, vault } = setup()
  let [call] = await g.apply([{
    entity: { eid: 'c1' },
    call: { args: { bundles: [sealed('A', 'hidden')] } },
  }])
  let args = (call.call as Record<string, { bundles: Bundle[] }>).args
  assert(!JSON.stringify(args).includes('hidden'))
  let [bundle] = args.bundles
  await g.apply([bundle])
  assertEquals(await reveal(vault, 'A'), 'hidden')
  assertEquals(
    (await row(g, 'A'))!.value,
    (bundle.secret as Record<string, string>).value,
  )
})

let bound = setup()
await bound.g.apply([
  sealed('A', 'op://v/item/key'),
  sealed('B', 'op://v/gone/x'),
])
let noItem = new Error('no such item')
test('a name resolves through the vault, then 1Password, then the environment', async () => {
  let { vault } = bound
  let op = (ref: string) =>
    ref == 'op://v/item/key' ? Promise.resolve('from-op') : Promise.reject(
      noItem,
    )
  let env = (name: string) => `env:${name}`
  assertEquals(await reveal(vault, 'C', { env }), 'env:C')
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

test('peek answers on the spot, with 1Password values warmed first', async () => {
  let { g, vault } = setup()
  let op = () => Promise.resolve('warm')
  await g.apply([sealed('A', 'plain'), sealed('B', 'op://v/item/warm')])
  assertEquals(peek(vault, 'A', none), 'plain')
  assertEquals(peek(vault, 'C', { env: () => 'env' }), 'env')
  await warm(vault, ['B'], { op })
  assertEquals(peek(vault, 'B', { op }), 'warm')
})

// A record's write lands in the vault the way the plugin's seal puts it there
// (./plugin.ts), so the lock is the only thing between two changes.
let sealing = (vault: Local) => ({
  apply: (bundles: Bundle[]) => {
    for (let b of bundles) {
      let { value } = b.secret as Record<string, string>
      vault.seal(b.entity.eid, { handle: 'h', value })
    }
  },
})

test('records change one at a time, under the vault lock', async () => {
  let vault = ramVault()
  let store = records<{ n?: number }>(sealing(vault), vault, 'count ')
  let add = () =>
    store.update('a', (r) => Promise.resolve(void (r.n = (r.n ?? 0) + 1)))
  await Promise.all([add(), add()])
  assertEquals(await store.read('a'), { n: 2 })
})

let recorded = setup()
test('a record is written back through the graph, which keeps its handle', async () => {
  let { g, vault } = recorded
  let store = records<{ n?: number }>(g, vault, 'count ')
  assertEquals(await store.read('a'), undefined)
  await store.update('a', (r) => Promise.resolve(void (r.n = 1)))
  assertEquals(await store.read('a'), { n: 1 })
  assert(isHandle((await row(g, 'count a'))!.value))
})

let documented = setup()
let purpose = { title: 'Service access', body: 'Used by the mail service.' }
let documentedOut = await documented.g.apply([{
  ...sealed('DOCUMENTED', 'fixture-token'),
  doc: purpose,
}])
test('a secret can carry optional purpose documentation without changing its identity', async () => {
  let { g, vault } = documented
  let doc = purpose
  let out = documentedOut
  assertEquals(out[0].entity.eid, secretEid('DOCUMENTED'))
  assertEquals((await g.get([secretEid('DOCUMENTED')], ['doc']))[0].doc, doc)
  assertEquals(await reveal(vault, 'DOCUMENTED'), 'fixture-token')
  await g.apply([sealed('DOCUMENTED', 'rotated-fixture')])
  assertEquals((await g.get([secretEid('DOCUMENTED')], ['doc']))[0].doc, doc)
  await g.apply([sealed('UNDOCUMENTED', 'fixture-token')])
  assertEquals(
    (await g.get([secretEid('UNDOCUMENTED')], ['doc']))[0].doc,
    undefined,
  )
})
