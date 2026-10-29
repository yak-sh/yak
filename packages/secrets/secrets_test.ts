import { docDoc } from '@yaks/doc'
// A secret through the graph: the value goes to the vault once the write has
// committed, the graph keeps the handle, and nothing refused leaves anything
// behind.

import { clock, test, until } from '@yaks/testing'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import type { Clock } from '@yaks/fp'
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
} from './mod.ts'

// The graph a host builds: the plugin over one vault, writing what it says
// about a seal back through the graph, and reporting where the graph does. `call` is @yaks/tools', a component whose
// text carries a whole batch as JSON. `failed` records a terminal seal outcome;
// the original failure reaches the graph's reporter.
// `owned` takes what it is on with its owner, the way a connection goes with
// its space.
let ownedDoc = {
  title: 'owned',
  $defs: {
    owned: {
      component: true,
      type: 'object',
      properties: {
        owner: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
  },
}
let vocab = loadVocab([
  secretsDoc,
  provisionalDoc,
  toolsDoc,
  docDoc,
  kernelDoc,
  ownedDoc,
])
let setup = <V extends Vault = Local>(
  vault: V = ramVault() as V,
  time?: Clock,
) => {
  let reported: unknown[] = []
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [
      secrets(vault, (b) => g.apply(b, { trusted: true }), vocab, time),
    ],
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
    plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }), vocab)],
    report: (e) => void reported.push(e),
  })
  await g.apply([sealed('A', 'one'), sealed('B', 'two')])
  assertEquals(await reveal(vault, 'A', none), 'one')
  assertEquals(await reveal(vault, 'B', none), 'two')
  assertEquals((await whole(g, 'A'))!.provisional, undefined)
  assertEquals((await whole(g, 'B'))!.provisional, undefined)
  assertEquals(reported, [])
})

// A graph where A was written once, and the handle it keeps for A.
let written = async () => {
  let at = setup()
  await at.g.apply([sealed('A', 'one')])
  return { ...at, first: (await row(at.g, 'A'))!.value }
}

let rotating = await written()
test('a secret keeps its handle when its value changes', async () => {
  let { g, vault, first } = rotating
  await g.apply([sealed('A', 'two')])
  assertEquals((await row(g, 'A'))!.value, first)
  assertEquals(await reveal(vault, 'A'), 'two')
})

let restating = await written()
test('a secret written back as its handle changes nothing', async () => {
  let { g, vault, first } = restating
  await g.apply([sealed('A', first)])
  assertEquals(await reveal(vault, 'A'), 'one')
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

// A vault in memory that notes every drop it is asked for, failing one with
// each error it is handed, in turn.
let dropping = (...errors: Error[]) => {
  let vault = ramVault()
  let asked: string[] = []
  return {
    ...vault,
    asked,
    drop: (eid: string) => {
      asked.push(eid)
      let e = errors.shift()
      return e ? Promise.reject(e) : vault.drop(eid)
    },
  }
}

// A secret A, a page and a note that hold none, and a secret B that goes with
// the page.
let holding = async (vault = dropping(), time?: Clock) => {
  let at = setup(vault, time)
  await at.g.apply([
    sealed('A', 'one'),
    { entity: { eid: 'page' }, doc: { title: 'Page' } },
    { entity: { eid: 'note' }, doc: { title: 'Note' } },
    { ...sealed('B', 'two'), owned: { owner: 'page' } },
  ])
  return at
}

let noting = await holding()
test('deleting what holds no secret asks the vault nothing', async () => {
  let { g, vault } = noting
  await g.apply([{ entity: { eid: 'note' }, $delete: true }])
  await g.apply([{ entity: { eid: 'page' }, doc: null }])
  assertEquals(vault.asked, [])
})

let cascading = await holding()
test('a secret a delete takes with it is dropped from the vault', async () => {
  let { g, vault } = cascading
  await g.apply([{ entity: { eid: 'page' }, $delete: true }])
  assertEquals(vault.asked, [secretEid('B')])
  assertEquals(vault.all().map(([eid]) => eid), [secretEid('A')])
})

let dropTime = clock()
let redropping = await holding(dropping(transient()), dropTime)
test('a drop the vault calls retryable is tried again until it lands', async () => {
  let { g, vault, reported } = redropping
  let deleting = g.apply([unsealed('A')])
  await until(dropTime.pending)
  await dropTime.advance(2_000)
  await deleting
  assertEquals(vault.asked, [secretEid('A'), secretEid('A')])
  assertEquals(await reveal(vault, 'A', none), undefined)
  assertEquals(reported, [])
})

test('a vault read a write waits on is tried again when it fails retryably', async () => {
  let time = clock()
  let base = ramVault()
  let errors = [transient()]
  let { g, reported } = setup({
    ...base,
    read: (eid: string) => {
      let e = errors.shift()
      return e ? Promise.reject(e) : Promise.resolve(base.read(eid))
    },
  }, time)
  let writing = g.apply([sealed('A', 'one')])
  await until(time.pending)
  await time.advance(2_000)
  await writing
  assertEquals(await reveal(base, 'A'), 'one')
  assertEquals(reported, [])
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
  let time = clock()
  let { g, vault, reported } = setup(failing(transient()), time)
  let writing = g.apply([sealed('A', 'one')])
  await until(time.pending)
  let said = (await whole(g, 'A'))!
  assertEquals(said.provisional, { note: 'Saving the key, trying again' })
  assert(String((said.content as Record<string, string>).body).includes('lost'))
  await time.advance(2_000)
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
  let time = clock()
  let { g, reported } = setup(failing(...[1, 2, 3, 4, 5].map(transient)), time)
  let writing = g.apply([sealed('A', 'one')])
  for (let i = 0; i < 5; i++) await time.advance(2_000)
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

// A call whose arguments carry a secret's value, recorded, and the bundles its
// arguments carry as recorded.
let calling = {
  entity: { eid: 'c1' },
  call: { args: { bundles: [sealed('A', 'hidden')] } },
}
let carried = (call: Bundle) =>
  (call.call as Record<string, { bundles: Bundle[] }>).args.bundles

let recording = setup()
test('a secret inside a call is its handle there too', async () => {
  let [call] = await recording.g.apply([calling])
  assert(!JSON.stringify(carried(call)).includes('hidden'))
})

let called = setup()
let [bundle] = carried((await called.g.apply([calling]))[0])
test('a secret inside a call is sealed when the call applies it', async () => {
  let { g, vault } = called
  await g.apply([bundle])
  assertEquals(await reveal(vault, 'A'), 'hidden')
  assertEquals(
    (await row(g, 'A'))!.value,
    (bundle.secret as Record<string, string>).value,
  )
})

let local = setup()
await local.g.apply([sealed('A', 'local'), sealed('B', 'op://v/item/key')])
test('runtime secret reads use local values and environment without reading 1Password', async () => {
  let reads = 0
  let sources = {
    env: (name: string) => `env:${name}`,
    op: () => Promise.resolve((reads++, 'from-op')),
    opNow: () => (reads++, 'from-op'),
  }
  let cases: [string, string | undefined][] = [
    ['A', 'local'],
    ['B', undefined],
    ['C', 'env:C'],
  ]
  for (let [name, value] of cases) {
    assertEquals(await reveal(local.vault, name, sources), value)
    assertEquals(peek(local.vault, name, sources), value)
  }
  assertEquals(reads, 0)
})

test('a reference kept as a value or exported variable is not returned as a credential', async () => {
  let vault = ramVault()
  vault.seal(secretEid('A'), { handle: 'h', value: 'op://v/item/key' })
  let sources = { env: () => 'op://v/item/key' }
  for (let name of ['A', 'B']) {
    assertEquals(await reveal(vault, name, sources), undefined)
    assertEquals(peek(vault, name, sources), undefined)
  }
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
