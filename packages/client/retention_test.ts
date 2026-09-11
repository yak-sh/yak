/// <reference lib="deno.ns" />
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { echo } from '@yaks/sync'
import { client, type ClientOpts } from './client.ts'
import { box, comp, fakeDb, fakeIdb, pair } from './harness.ts'
import { wireIdb } from './idb.ts'
import { type Saved, stash } from './vault.ts'
import { wireStash, type WireVault } from './wire-vault.ts'

let row = (eid: string, num = 10): Bundle => ({
  entity: { eid, num },
  doc: { title: eid },
})
let saved = (eid: string): Saved => ({
  eid,
  num: 10,
  comps: { doc: { title: eid } },
})
let fixture = (opts: ClientOpts = {}) => {
  let sockets = [pair().client]
  let c = client(box, [], {
    url: 'http://box.test',
    vault: false,
    wireVault: false,
    connect: () => sockets.at(-1)!,
    timer: () => {},
    fetch: () => Response.json([]),
    ...opts,
  })
  let frame = (id: string, bundles: Bundle[] = [], gone: string[] = []) =>
    sockets.at(-1)!.emit('message', JSON.stringify({ id, bundles, gone }))
  return { c, frame, sockets }
}
let readIds = (bundles: Bundle[]) => bundles.map((b) => b.entity.eid)

Deno.test('inactive LRU is bounded, reads touch without changing query order', () => {
  let { c, frame } = fixture({ retention: 2 })
  let w = c.watch('.doc!')
  frame('s1', [row('a'), row('b')])
  w.close()
  assertEquals(c.cache.size(), 2)
  c.ent('a') // b is now the least recently used; query order stays a,b
  assertEquals(readIds(c.store.read('.doc!')), ['a', 'b'])
  let z = c.watch('.title=c')
  frame('s2', [row('c')])
  z.close()
  assertEquals(c.ent('b'), undefined)
  assertEquals(readIds(c.store.read('.doc!')), ['a', 'c'])
  assertEquals(c.cache.size(), 2)
  c.close()
})

Deno.test('active/shared owners exceed the inactive bound and gone is per answer', () => {
  let { c, frame } = fixture({ retention: 0 })
  let a = c.watch('.doc!')
  let b = c.watch('.title=a')
  frame('s1', [row('a'), row('b')])
  frame('s2', [row('a')])
  assertEquals(c.cache.size(), 0)
  assertEquals(c.read('.doc!').length, 2)
  let notified = 0
  b.subscribe(() => notified++)
  frame('s2', [], ['a'])
  assertEquals(b.value, []) // another owner still holds the shared payload
  assertEquals(readIds(a.value), ['a', 'b'])
  assert(notified > 0)
  assert(c.ent('a'))
  a.close()
  assertEquals(c.ent('a'), undefined)
  assertEquals(c.ent('b'), undefined)
  b.close()
  c.close()
})

Deno.test('reopen before first frame pins retained hits; empty frame reconciles stale floor', () => {
  let { c, frame } = fixture({ retention: 1 })
  let old = c.watch('.doc!')
  frame('s1', [row('a')])
  old.close()
  let again = c.watch('.doc!')
  assertEquals(readIds(again.value), ['a'])
  assertEquals(again.ready, false)
  let other = c.watch('.title=b')
  frame('s3', [row('b')])
  other.close()
  assert(c.ent('a'))
  frame('s2')
  assertEquals(again.ready, true)
  assertEquals(again.value, [])
  assertEquals(c.ent('a'), undefined)
  // Authoritative first answer also reconciles retained matches never owned
  // by this particular query text.
  let unseen = c.watch('.title=b')
  assertEquals(readIds(unseen.value), ['b'])
  frame('s4')
  assertEquals(unseen.value, [])
  assertEquals(c.ent('b'), undefined)
  c.close()
})

Deno.test('snapshots replace absent wire fields and preserve local/none on gone', async () => {
  let vault = stash()
  let { c, frame } = fixture({ vault, retention: 0 })
  await c.ready
  let w = c.watch('.doc!')
  frame('s1', [{
    ...row('a'),
    doc: { title: 'a', body: 'obsolete' },
    recipe: { serves: 2 },
  }])
  await c.mutate([{
    entity: { eid: 'a' },
    draft: { text: 'mine' },
    sieve: { text: 'tab' },
  }])
  await c.wire!.idle()
  frame('s1', [row('a')])
  assertEquals(comp(c.ent('a'), 'doc').body, null)
  assertEquals(comp(c.ent('a'), 'recipe'), {})
  frame('s1', [], ['a'])
  assertEquals(w.value, [])
  assertEquals(comp(c.ent('a'), 'draft').text, 'mine')
  assertEquals(comp(c.ent('a'), 'sieve').text, 'tab')
  assertEquals((await vault.load())[0].comps.draft, { text: 'mine' })
  assertEquals(c.ent('a')?.tombstone, undefined)
  c.close()
})

Deno.test('eviction physically drops payloads and restore keeps identity, not a tombstone', () => {
  let { c, frame } = fixture({ retention: 0 })
  let w = c.watch('.doc!')
  frame('s1', [row('a', 75)])
  w.close()
  assertEquals(c.ent('a'), undefined)
  assertEquals(c.store.read(''), [])
  let again = c.watch('.doc!')
  frame('s2', [{ entity: { eid: 'a' }, doc: { title: 'back' } }])
  assertEquals(c.ent('a')?.entity.num, 75)
  assertEquals(readIds(again.value), ['a'])
  c.close()
})

Deno.test('pending optimistic writes survive pressure, gone and stale socket snapshots', async () => {
  let answer = Promise.withResolvers<Response>()
  let { c, frame } = fixture({ retention: 0, fetch: () => answer.promise })
  let w = c.watch('.doc!')
  frame('s1', [row('a')])
  c.mutate([{ entity: { eid: 'a' }, doc: { title: 'optimistic' } }])
  frame('s1', [row('a')])
  assertEquals(comp(c.ent('a'), 'doc').title, 'optimistic')
  frame('s1', [], ['a'])
  w.close()
  assertEquals(comp(c.ent('a'), 'doc').title, 'optimistic')
  answer.resolve(
    Response.json([{ entity: { eid: 'a' }, doc: { title: 'accepted' } }]),
  )
  await c.wire!.idle()
  assertEquals(c.ent('a'), undefined)
  c.close()
})

Deno.test('overlapping pending writes release only their own pins; uncertain transport stays pinned', async () => {
  let first = Promise.withResolvers<Response>()
  let second = Promise.withResolvers<Response>()
  let calls = 0
  let { c } = fixture({
    retention: 0,
    fetch: () => ++calls === 1 ? first.promise : second.promise,
    report: () => {},
  })
  c.mutate([row('a')])
  c.mutate([{ entity: { eid: 'a' }, doc: { title: 'second' } }])
  first.resolve(Response.json([]))
  await Promise.resolve()
  await Promise.resolve()
  assert(c.ent('a'))
  second.reject(new Error('offline'))
  await c.wire!.idle()
  assert(c.ent('a'))
  c.close()
})

Deno.test('eviction invalidates local watches without sending deletes', () => {
  let { c, frame, sockets } = fixture({ retention: 0 })
  let local = c.watch('.doc!', { remote: false })
  let remote = c.watch('.doc!')
  frame('s1', [row('a')])
  assertEquals(readIds(local.value), ['a'])
  remote.close()
  assertEquals(local.value, [])
  assertEquals(
    sockets[0].sent.filter((m) => (m as { unsubscribe?: string }).unsubscribe)
      .length,
    0,
  ) // socket never opened
  c.close()
})

for (let name of ['memory', 'indexedDB']) {
  Deno.test('bounded epoch wire vault: ' + name, async () => {
    let indexedDB = fakeDb()
    let vault = name === 'memory' ? wireStash() : wireIdb({ indexedDB })
    assertEquals(await vault.load('one', 3), [])
    await vault.save('one', ['a', 'b', 'c', 'd'].map(saved), 3)
    assertEquals(
      (await vault.load('one', 3)).map((r) => r.eid),
      ['b', 'c', 'd'],
    )
    await vault.save('one', [saved('b')], 3)
    assertEquals(
      (await vault.load('one', 2)).map((r) => r.eid),
      ['d', 'b'],
    )
    assertEquals(await vault.load('two', 2), [])
    await vault.save('one', [saved('stale-tab')], 2)
    await vault.drop('one', ['d'])
    assertEquals(await vault.load('two', 2), [])
    await vault.save('two', [saved('new')], 2)
    let reopened = name === 'memory' ? vault : wireIdb({ indexedDB })
    assertEquals((await reopened.load('two', 2)).map((r) => r.eid), ['new'])
    assertEquals(await reopened.load('two', 0), [])
  })
}

Deno.test('wire disk paint is bounded, unready, and same-epoch reopen reconciles stale hits', async () => {
  let vault = wireIdb({ indexedDB: fakeDb() })
  await vault.load('one', 100)
  await vault.save('one', ['a', 'b', 'c'].map(saved), 100)
  let { c, frame } = fixture({ epoch: 'one', wireVault: vault, retention: 2 })
  let w = c.watch('.doc!')
  await c.ready
  assertEquals(readIds(w.value), ['b', 'c'])
  assertEquals(w.ready, false)
  frame('s1', [row('c')])
  assertEquals(readIds(w.value), ['c'])
  assertEquals(w.ready, true)
  await c.cache.idle()
  assertEquals((await vault.load('one', 2)).map((r) => r.eid), ['c'])
  c.close()
})

Deno.test('epoch mismatch invalidates only server tier, including ready state', async () => {
  let db = fakeDb()
  let vault = fakeIdb(db)
  let wireVault = wireIdb({ indexedDB: db })
  let { c, frame } = fixture({ vault, wireVault, epoch: 'one' })
  await c.ready
  let w = c.watch('.doc!')
  frame('s1', [row('a')])
  await c.mutate([{ entity: { eid: 'a' }, draft: { text: 'keep' } }])
  await c.wire!.idle()
  assertEquals(w.ready, true)
  await c.setEpoch('two')
  assertEquals(w.ready, false)
  assertEquals(w.value, [])
  assertEquals(comp(c.ent('a'), 'doc'), {})
  assertEquals(comp(c.ent('a'), 'draft').text, 'keep')
  assertEquals((await vault.load())[0].comps.draft, { text: 'keep' })
  assertEquals(await wireVault.load('two', 10), [])
  c.close()
})

let deferredVault = () => {
  let read = Promise.withResolvers<Saved[]>()
  let base = wireStash()
  let vault: WireVault = { ...base, load: () => read.promise }
  return { read, vault }
}

Deno.test('late wire hydration cannot overwrite local writes, socket rows, or an empty first answer', async () => {
  for (let mode of ['local', 'socket', 'empty']) {
    let { read, vault } = deferredVault()
    let { c, frame } = fixture({ epoch: 'one', wireVault: vault })
    let w = c.watch('.doc!')
    if (mode === 'local') {
      await c.mutate([{ entity: { eid: 'a' }, doc: { title: 'newer' } }])
    }
    if (mode === 'socket') {
      frame('s1', [{ entity: { eid: 'a' }, doc: { title: 'newer' } }])
    }
    if (mode === 'empty') frame('s1')
    read.resolve([saved('a')])
    await c.ready
    assertEquals(
      comp(c.ent('a'), 'doc').title,
      mode === 'empty' ? undefined : 'newer',
    )
    assertEquals(w.ready, mode !== 'local')
    c.close()
  }
})

Deno.test('late local hydration does not overwrite edits or deletions', async () => {
  let read = Promise.withResolvers<Saved[]>()
  let vault = { ...stash(), load: () => read.promise }
  let { c } = fixture({ vault })
  await c.mutate([{ entity: { eid: 'a' }, draft: { text: 'newer' } }])
  await c.mutate([{ entity: { eid: 'b' }, draft: null }])
  read.resolve([{ eid: 'a', comps: { draft: { text: 'old' } } }, {
    eid: 'b',
    comps: { draft: { text: 'old' } },
  }])
  await c.ready
  assertEquals(comp(c.ent('a'), 'draft').text, 'newer')
  assertEquals(comp(c.ent('b'), 'draft'), {})
  c.close()
})

Deno.test('retention validates bounds and never defaults to an unbounded disk read', () => {
  for (let retention of [-1, NaN, Infinity, 1.5]) {
    assertThrows(() => fixture({ retention }))
  }
})

Deno.test('storage enumeration and reactive refresh do not touch LRU', async () => {
  let { c, frame } = fixture({ retention: 2 })
  let w = c.watch('.doc!')
  frame('s1', [row('a'), row('b')])
  w.close()
  c.store.read('.doc!')
  await c.graph.apply(echo([row('c')]))
  await Promise.resolve()
  assertEquals(c.ent('a'), undefined)
  assert(c.ent('b'))
  assert(c.ent('c'))
  c.close()
})

Deno.test('a render can close its watch during an optimistic write without evicting it', async () => {
  let answer = Promise.withResolvers<Response>()
  let { c, frame } = fixture({ retention: 0, fetch: () => answer.promise })
  let w = c.watch('.doc!')
  frame('s1', [row('a')])
  w.subscribe(() => {
    if (comp(w.value[0], 'doc').title === 'edited') w.close()
  })
  c.mutate([{ entity: { eid: 'a' }, doc: { title: 'edited' } }])
  assertEquals(comp(c.ent('a'), 'doc').title, 'edited')
  answer.resolve(Response.json([]))
  await c.wire!.idle()
  assertEquals(c.ent('a'), undefined)
  c.close()
})

Deno.test('same epoch validation never overwrites an already newer RAM row', async () => {
  let vault = wireStash()
  await vault.load('one', 10)
  await vault.save('one', [saved('a')], 10)
  let { c, frame } = fixture({ wireVault: vault })
  c.watch('.doc!')
  frame('s1', [{ entity: { eid: 'a' }, doc: { title: 'newer than disk' } }])
  await c.setEpoch('one')
  assertEquals(comp(c.ent('a'), 'doc').title, 'newer than disk')
  c.close()
})

Deno.test('close cancels an outstanding disk restore', async () => {
  let { read, vault } = deferredVault()
  let { c } = fixture({ epoch: 'one', wireVault: vault })
  c.watch('.doc!')
  c.close()
  read.resolve([saved('a')])
  await c.ready
  assertEquals(c.ent('a'), undefined)
  assertEquals(c.watches.size(), 0)
})

Deno.test('a newer epoch supersedes an outstanding older hydration', async () => {
  let read = Promise.withResolvers<Saved[]>()
  let loads = 0
  let vault: WireVault = {
    ...wireStash(),
    load: () => ++loads === 1 ? read.promise : Promise.resolve([saved('b')]),
  }
  let { c } = fixture({ epoch: 'one', wireVault: vault })
  let next = c.setEpoch('two')
  read.resolve([saved('a')])
  await Promise.all([c.ready, next])
  assertEquals(c.ent('a'), undefined)
  assertEquals(comp(c.ent('b'), 'doc').title, 'b')
  c.close()
})

Deno.test('refusal releases pending protection after restoring the old image', async () => {
  let response = Promise.withResolvers<Response>()
  let { c, frame } = fixture({
    retention: 0,
    fetch: () => response.promise,
    report: () => {},
  })
  let w = c.watch('.doc!')
  frame('s1', [row('a')])
  c.mutate([{ entity: { eid: 'a' }, doc: { title: 'edited' } }])
  w.close()
  assertEquals(comp(c.ent('a'), 'doc').title, 'edited')
  response.resolve(
    Response.json({ error: 'Refused', message: 'no' }, { status: 403 }),
  )
  await c.wire!.idle()
  assertEquals(c.ent('a'), undefined)
  c.close()
})

Deno.test('local-only graphs do not evict their sole copy of wire-default data', async () => {
  let c = client(box, [], { vault: false, retention: 0 })
  await c.mutate([row('a'), row('b')])
  await Promise.resolve()
  assertEquals(readIds(c.read('.doc!')), ['a', 'b'])
  assertEquals(c.cache.size(), 0)
  c.close()
})

Deno.test('a synchronous first frame filters stale shared hits before watch returns', () => {
  let { c, frame, sockets } = fixture()
  let a = c.watch('.doc!')
  sockets[0].emit('open')
  frame('s1', [row('a')])
  let send = sockets[0].send
  sockets[0].send = (data) => {
    send(data)
    let message = JSON.parse(data)
    if (message.subscribe) frame(message.id)
  }
  let b = c.watch('.title=a')
  assertEquals(b.ready, true)
  assertEquals(b.value, [])
  assertEquals(readIds(a.value), ['a'])
  c.close()
})

Deno.test('query replica applies transient frames without persisting projections', async () => {
  const { client } = await import('./client.ts')
  const { loadVocab } = await import('@yaks/vocab')
  const c = client(
    loadVocab([{
      $defs: { text: { properties: { body: { type: 'string' } } } },
    }]),
    [],
    { vault: false },
  )
  try {
    c.cache.subscribe('live', '.text')
    await c.cache.land({
      id: 'live',
      bundles: [{ entity: { eid: 'd' }, text: { body: '' } }],
    })
    const watch = c.watch('.text')
    await c.cache.land({
      id: 'live',
      transient: [{
        id: 's',
        entity: 'd',
        component: 'text',
        property: 'body',
        seq: 0,
        op: 'begin',
        text: '',
      }],
    })
    await c.cache.land({
      id: 'live',
      transient: [{
        id: 's',
        entity: 'd',
        component: 'text',
        property: 'body',
        seq: 1,
        op: 'append',
        text: 'hello',
      }],
    })
    assertEquals(watch.value[0].text, { body: 'hello' })
    assertEquals(c.cache.answer('live')[0].text, { body: 'hello' })
    assertEquals(c.ent('d')!.text, { body: '' })
    await c.cache.land({
      id: 'live',
      bundles: [{ entity: { eid: 'd' }, text: { body: 'hello' } }],
      transient: [{
        id: 's',
        entity: 'd',
        component: 'text',
        property: 'body',
        seq: 2,
        op: 'end',
      }],
    })
    assertEquals(watch.value[0].text, { body: 'hello' })
  } finally {
    c.close()
  }
})
