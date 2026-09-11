/// <reference lib="deno.ns" />
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { echo, type Frame, type Trouble } from '@yaks/sync'
import { client, type ClientOpts } from './client.ts'
import { box, comp, fakeDb, pair } from './harness.ts'
import { wireIdb } from './idb.ts'
import { wireStash } from './wire-vault.ts'

let row = (eid: string): Bundle => ({
  entity: { eid },
  doc: { title: eid },
})
let ids = (rows: Bundle[]) => rows.map((b) => b.entity.eid)
let fixture = (opts: ClientOpts = {}) => {
  let sockets = [pair().client]
  let trouble: Trouble[] = []
  let retry = () => {}
  let c = client(box, [], {
    url: 'http://box.test',
    vault: false,
    wireVault: false,
    connect: () => sockets.at(-1)!,
    timer: (fn) => {
      retry = fn
    },
    report: (t) => {
      trouble.push(t)
    },
    fetch: () => Response.json([]),
    ...opts,
  })
  let frame = (frame: Frame) =>
    sockets.at(-1)!.emit('message', JSON.stringify(frame))
  let reopen = () => {
    sockets.at(-1)!.close()
    sockets.push(pair().client)
    retry()
    sockets.at(-1)!.emit('open')
  }
  return { c, frame, sockets, trouble, reopen }
}
let server = { evaluate: 'server' } as const

Deno.test('server evaluation never parses, filters or primes the query locally', async () => {
  let { c, frame, trouble } = fixture({ wireVault: wireStash() })
  // Even the first prime and later epoch hydration must not ask RAM to run
  // these opaque server contracts. This is a transport test, not proof that
  // the server supports a particular grammar or aggregate result shape.
  c.store.read = () => {
    throw new Error('local evaluation forbidden')
  }
  for (
    let query of [
      'café',
      '.near=a',
      '.requires->a',
      '.title=unloaded&.fields=eid',
      '.limit=1&.after=50',
      '.tally=recipe.course',
    ]
  ) {
    let w = c.watch(query, server)
    assertEquals(w.value, [])
    assertEquals(w.ready, false)
  }
  await c.setEpoch('boot')
  for (let n = 1; n <= 6; n++) {
    frame({ id: 's' + n, bundles: [row('hit' + n)] })
  }
  assertEquals(c.watches.size(), 0) // no local evaluator registrations
  assertEquals(ids(c.watch('café', server).value), ['hit1'])
  assertEquals(trouble, [])
  c.close()
})

Deno.test('server membership is authoritative even when fields/far targets are unloaded', () => {
  let { c, frame } = fixture()
  let w = c.watch('.recipe.cook.doc.title=unloaded', server)
  frame({ id: 's1', bundles: [row('hit')] })
  assertEquals(ids(w.value), ['hit'])
  assertEquals(w.ready, true)
  let n = 0
  w.subscribe(() => n++)
  c.graph.apply(echo([{ entity: { eid: 'hit' }, doc: { title: 'changed' } }]))
  assertEquals(comp(w.value[0], 'doc').title, 'changed')
  assert(n > 0)
  n = 0
  c.graph.apply(echo([row('other')]))
  assertEquals(n, 0)
  // A pinned speculative write is not evidence of membership in a server set.
  let release = c.cache.protect(['other'])
  assertEquals(ids(w.value), ['hit'])
  assertEquals(n, 0)
  release()
  assertEquals(n, 0)
  c.close()
})

Deno.test('replacement preserves server ranking; content deltas do not reorder', () => {
  let { c, frame } = fixture()
  let w = c.watch('.order=title&.limit=2', server)
  frame({ id: 's1', bundles: [row('z'), row('a')] })
  assertEquals(ids(w.value), ['z', 'a']) // do not sort on incomplete local fields
  frame({ id: 's1', bundles: [row('a'), row('z')], reset: true })
  assertEquals(ids(w.value), ['a', 'z'])
  frame({ id: 's1', bundles: [row('a')] })
  assertEquals(ids(w.value), ['a', 'z'])
  let other = c.watch('.doc!', server)
  frame({ id: 's2', bundles: [row('z')] })
  frame({ id: 's1', gone: ['z'] })
  assertEquals(ids(w.value), ['a'])
  assertEquals(ids(other.value), ['z'])
  assert(c.ent('z')) // leaving one answer cannot remove another owner's row
  c.close()
})

Deno.test('server watches dedupe and dispose independently from locally evaluated watches', () => {
  let { c, frame, sockets } = fixture()
  let a = c.watch('.doc!', server)
  let b = c.watch('.doc!', { ...server, remote: true })
  let local = c.watch('.doc!')
  sockets[0].emit('open')
  assertEquals(sockets[0].sent, [
    { subscribe: '.doc!', id: 's1' },
    { subscribe: '.doc!', id: 's2' },
  ])
  let heard = 0
  let same = () => heard++
  a.subscribe(same)
  b.subscribe(same)
  a.close()
  a.close()
  a.subscribe(same)
  frame({ id: 's1', bundles: [] })
  assertEquals(heard, 1)
  assertEquals(b.ready, true)
  b.close()
  assertEquals(sockets[0].sent.at(-1), { unsubscribe: 's1' })
  frame({ id: 's1', bundles: [row('late')] })
  assertEquals(c.ent('late'), undefined)
  assertEquals(local.ready, false)
  local.close()
  assertEquals(c.watches.size(), 0)
  c.close()
})

Deno.test('disconnect/refusal keep server paint but readiness awaits a successful reset', () => {
  let { c, frame, sockets, trouble, reopen } = fixture()
  let w = c.watch('.near=somewhere', server)
  frame({ id: 's1', bundles: [row('old')] })
  let states: boolean[] = []
  w.subscribe(() => states.push(w.ready))
  reopen()
  assertEquals(w.ready, false)
  assertEquals(ids(w.value), ['old'])
  sockets[0].emit(
    'message',
    JSON.stringify({ id: 's1', bundles: [row('late')] }),
  )
  assertEquals(c.ent('late'), undefined)
  frame({ id: 's1', refused: { error: 'Refused', message: 'no vectors' } })
  assertEquals(w.ready, false)
  assertEquals(ids(w.value), ['old'])
  assertEquals(trouble.length, 1)
  frame({ id: 's1', bundles: [] })
  assertEquals(w.value, [])
  assertEquals(w.ready, true)
  assertEquals(states[0], false)
  assertEquals(states.at(-1), true)
  c.close()
})

Deno.test('server-only reopens restore bounded semantic membership without local matching', async () => {
  let disk = wireStash()
  let { c, frame } = fixture({ wireVault: disk, epoch: 'boot' })
  await c.ready
  let w = c.watch('café', server)
  frame({ id: 's1', bundles: [row('hit')] })
  w.close()
  await c.cache.idle()
  let again = c.watch('café', server)
  assertEquals(ids(again.value), ['hit'])
  assertEquals(again.ready, false)
  assert(c.ent('hit')) // payload retention still works
  c.close()
  let next = fixture({ wireVault: disk, epoch: 'boot' }).c
  let cold = next.watch('café', server)
  await next.ready
  assertEquals(ids(cold.value), ['hit'])
  assertEquals(cold.ready, false)
  assert(next.ent('hit'))
  next.close()
})

Deno.test('cache observers see commits and physical eviction without tombstones or outbound writes', () => {
  let { c, frame } = fixture({ retention: 0 })
  let seen: [string, boolean][] = []
  let stop = c.cache.onRows((eids) => {
    for (let eid of eids) seen.push([eid, !!c.ent(eid)])
  })
  let w = c.watch('.near=a', server)
  frame({ id: 's1', bundles: [row('hit')] })
  assertEquals(seen, [['hit', true]])
  w.close()
  assertEquals(seen, [['hit', true], ['hit', false]])
  assertEquals(c.ent('hit'), undefined)
  stop()
  let x = c.watch('.near=b', server)
  frame({ id: 's2', bundles: [row('other')] })
  x.close()
  assertEquals(seen.length, 2)
  c.close()
})

Deno.test('cache observers also see local-only commits and stop on client close', () => {
  let c = client(box, [], { vault: false, wireVault: false })
  let seen: string[][] = []
  c.cache.onRows((eids) => seen.push(eids))
  c.mutate([row('local')])
  assertEquals(seen, [['local']])
  c.close()
  c.graph.apply([row('after')])
  assertEquals(seen, [['local']])
})

Deno.test('server evaluation cannot silently become a local watch', () => {
  let local = client(box, [], { vault: false })
  assertThrows(() => local.watch('.doc!', server), Error, 'requires a remote')
  local.close()
  let { c } = fixture()
  assertThrows(
    () => c.watch('.doc!', { ...server, remote: false }),
    Error,
    'requires a remote',
  )
  c.close()
})

Deno.test('server evaluated synchronous first answers are visible before watch returns', () => {
  let socket = pair().client
  socket.emit('open')
  socket.send = (text: string) => {
    let ask = JSON.parse(text)
    if (ask.subscribe) {
      socket.emit(
        'message',
        JSON.stringify({ id: ask.id, bundles: [row('hit')] }),
      )
    }
  }
  let c = client(box, [], {
    url: 'http://box.test',
    connect: () => socket,
    vault: false,
    wireVault: false,
  })
  let w = c.watch('.near=a', server)
  assertEquals(w.ready, true)
  assertEquals(ids(w.value), ['hit'])
  c.close()
})

Deno.test('projected/full owners share fields, and departures unload only the released scope', () => {
  let { c, frame, trouble } = fixture({ retention: 0 })
  let whole = c.watch('whole', server)
  frame({
    id: 's1',
    bundles: [{
      ...row('a'),
      doc: { title: 'a', body: 'body' },
      recipe: { serves: 4 },
    }],
  })
  let projected = c.watch('projection', server)
  frame({ id: 's2', bundles: [row('a')], coverage: { a: { doc: ['title'] } } })
  assertEquals(comp(c.ent('a'), 'doc').body, 'body')
  assertEquals(c.cache.loaded('a', 'doc', 'body'), true)
  frame({
    id: 's2',
    bundles: [row('a')],
    reset: true,
    coverage: { a: { doc: ['title'] } },
  })
  assertEquals(comp(c.ent('a'), 'recipe').serves, 4)
  whole.close()
  assertEquals(comp(c.ent('a'), 'doc').body, undefined) // unload, not null
  assertEquals(c.cache.loaded('a', 'doc', 'body'), false)
  assertEquals(c.cache.loaded('a', 'doc', 'title'), true)
  assertEquals(comp(c.ent('a'), 'recipe'), {})
  assertEquals(ids(projected.value), ['a'])
  projected.close()
  assertEquals(c.ent('a'), undefined)
  assertEquals(trouble, [])
  c.close()
})

Deno.test('omission cannot erase another projected owner, explicit null is authoritative', () => {
  let { c, frame } = fixture()
  let p = c.watch('body', server)
  frame({
    id: 's1',
    bundles: [{ entity: { eid: 'a' }, doc: { body: 'kept' } }],
    coverage: { a: { doc: ['body'] } },
  })
  c.watch('whole', server)
  frame({ id: 's2', bundles: [row('a')] })
  assertEquals(comp(c.ent('a'), 'doc').body, 'kept')
  frame({
    id: 's2',
    bundles: [{ ...row('a'), doc: { title: 'a', body: null } }],
  })
  assertEquals(comp(c.ent('a'), 'doc').body, null)
  p.close()
  assertEquals(c.cache.loaded('a', 'doc', 'body'), true)
  c.close()
})

Deno.test('opt-in one-shot columns retain paint, not coverage, within the row budget', () => {
  let { c, frame } = fixture({ retention: 1, retainUnownedColumns: true })
  let list = c.watch('list', server)
  frame({ id: 's1', bundles: [row('a')], coverage: { a: { doc: ['title'] } } })
  let body = c.watch('body', server)
  frame({
    id: 's2',
    bundles: [{ entity: { eid: 'a' }, doc: { body: 'paint' } }],
    coverage: { a: { doc: ['body'] } },
  })
  body.close()
  assertEquals(comp(c.ent('a'), 'doc').body, 'paint')
  assertEquals(c.cache.loaded('a', 'doc', 'body'), false)
  frame({ id: 's1', bundles: [row('a')], coverage: { a: { doc: ['title'] } } })
  assertEquals(comp(c.ent('a'), 'doc').body, 'paint')
  let again = c.watch('body', server)
  assertEquals(again.ready, false)
  // A confirmed covered omission still clears the retained value.
  frame({
    id: 's3',
    bundles: [{ entity: { eid: 'a' }, doc: {} }],
    coverage: { a: { doc: ['body'] } },
    reset: true,
  })
  assertEquals(comp(c.ent('a'), 'doc').body, null)
  again.close()
  list.close()
  assertEquals(c.cache.size(), 1)
  let other = c.watch('other', server)
  frame({ id: 's4', bundles: [row('b')] })
  other.close()
  assertEquals(c.ent('a'), undefined)
  assertEquals(c.cache.size(), 1)
  c.close()
})

Deno.test('body omission is unloaded while covered omission is a known absence', () => {
  let { c, frame } = fixture()
  c.watch('bodyless', server)
  frame({
    id: 's1',
    bundles: [{ ...row('a'), doc: { title: 'a', body: 'old' } }],
  })
  frame({
    id: 's1',
    bundles: [row('a')],
    coverage: { a: { doc: ['title'] } },
    reset: true,
  })
  assertEquals(comp(c.ent('a'), 'doc').body, undefined)
  assertEquals(c.cache.loaded('a', 'doc', 'body'), false)
  frame({
    id: 's1',
    bundles: [{ entity: { eid: 'a' }, doc: {} }],
    coverage: { a: { doc: ['title'] } },
  })
  assertEquals(comp(c.ent('a'), 'doc').title, null)
  assertEquals(c.cache.loaded('a', 'doc', 'title'), true)
  c.close()
})

Deno.test('peer-only payloads are pinned, never members; each role releases independently', () => {
  let { c, frame } = fixture({ retention: 0 })
  let w = c.watch('riders', server)
  frame({
    id: 's1',
    peers: [{ ...row('peer'), doc: { title: 'peer', body: 'rider' } }],
  })
  assertEquals(w.value, [])
  assertEquals(w.ready, true)
  assert(c.ent('peer'))
  assertEquals(c.cache.includes('s1', 'peer'), false)
  assertEquals(c.cache.loaded('peer', 'recipe', 'serves'), false)
  let other = c.watch('also rider', server)
  frame({ id: 's2', peers: [row('peer')] })
  frame({ id: 's1', peerGone: ['peer'] })
  assert(c.ent('peer'))
  assertEquals(comp(c.ent('peer'), 'doc').body, undefined)
  frame({ id: 's2', bundles: [row('peer')] })
  frame({ id: 's2', gone: ['peer'] })
  assertEquals(other.value, [])
  assert(c.ent('peer')) // same sub still owns the rider role
  frame({ id: 's2', reset: true, bundles: [] })
  assertEquals(c.ent('peer'), undefined)
  c.close()
})

Deno.test('peer reset, full member overlap and pending pins survive independent releases', () => {
  let { c, frame } = fixture({ retention: 0 })
  c.watch('riders', server)
  frame({ id: 's1', peers: [row('a'), row('b')] })
  c.watch('member', server)
  frame({
    id: 's2',
    bundles: [{ ...row('a'), doc: { title: 'a', body: 'full' } }],
  })
  let release = c.cache.protect(['b'])
  frame({ id: 's1', reset: true, peers: [row('a')] })
  assert(c.ent('b'))
  assertEquals(comp(c.ent('a'), 'doc').body, 'full')
  frame({ id: 's1', peers: [{ ...row('b'), doc: { title: 'stale' } }] })
  assertEquals(comp(c.ent('b'), 'doc').title, 'b')
  frame({ id: 's1', peerGone: ['a', 'b'] })
  release()
  assertEquals(c.ent('b'), undefined)
  assertEquals(comp(c.ent('a'), 'doc').body, 'full')
  c.close()
})

for (let disk of ['memory', 'indexedDB']) {
  Deno.test(
    'ranked server answers and riders restore unready with epoch guard: ' +
      disk,
    async () => {
      let db = fakeDb()
      let vault = disk === 'memory' ? wireStash() : wireIdb({ indexedDB: db })
      let { c, frame } = fixture({ wireVault: vault, epoch: 'one' })
      await c.ready
      let w = c.watch('opaque ranking', server)
      frame({ id: 's1', bundles: [row('a'), row('b')], peers: [row('peer')] })
      frame({
        id: 's1',
        reset: true,
        bundles: [row('b'), row('a')],
        peers: [row('peer')],
      })
      w.close()
      c.graph.apply(echo([row('unrelated')]))
      await c.cache.idle()
      c.close()
      let next = fixture({
        wireVault: disk === 'memory' ? vault : wireIdb({ indexedDB: db }),
        epoch: 'one',
      })
      next.c.store.read = () => {
        throw new Error('local matching forbidden')
      }
      let reopen = next.c.watch('opaque ranking', server)
      await next.c.ready
      assertEquals(ids(reopen.value), ['b', 'a'])
      assertEquals(reopen.ready, false)
      assert(next.c.ent('peer'))
      assertEquals(next.c.cache.includes('s1', 'peer'), false)
      next.frame({ id: 's1', bundles: [] })
      assertEquals(reopen.value, [])
      assertEquals(reopen.ready, true)
      assertEquals(next.c.ent('peer'), undefined)
      await next.c.setEpoch('two')
      assertEquals(reopen.ready, false)
      assertEquals(reopen.value, [])
      assertEquals(next.c.cache.answerBytes(), 0)
      next.c.close()
      let stale = fixture({ wireVault: vault, epoch: 'two' })
      let again = stale.c.watch('opaque ranking', server)
      await stale.c.ready
      assertEquals(again.value, [])
      assertEquals(again.ready, false)
      stale.c.close()
    },
  )
}

Deno.test('answer metadata bounds include empty answers, long keys and coverage; eviction never invents hits', () => {
  let { c, frame } = fixture({ answerBytes: 250 })
  for (let i = 1; i <= 20; i++) {
    let w = c.watch('q' + i, server)
    frame({ id: 's' + i, bundles: i === 1 ? [row('a')] : [] })
    w.close()
    assert(c.cache.answerBytes() <= 250)
  }
  let again = c.watch('q1', server)
  assertEquals(again.value, [])
  assert(c.ent('a')) // payload still retained, but no semantic membership
  let big = c.watch('x'.repeat(400), server)
  frame({ id: 's22', bundles: [row('b')] })
  assertEquals(ids(big.value), ['b']) // live answer is not truncated
  big.close()
  assertEquals(c.watch('x'.repeat(400), server).value, [])
  c.close()
})

Deno.test('retained membership never restores evicted payloads or crosses semantic options', () => {
  let { c, frame } = fixture({ retention: 0 })
  let w = c.watch('opaque', server)
  frame({ id: 's1', bundles: [row('a')] })
  w.close()
  assertEquals(c.watch('opaque', server).value, [])
  frame({ id: 's2', bundles: [row('a')] })
  assertEquals(c.watch('opaque', { ...server, now: 123 }).value, [])
  c.close()
})

Deno.test('late answer hydration cannot revive an empty reply or an obsolete epoch', async () => {
  for (let mode of ['empty', 'epoch', 'close']) {
    let base = wireStash()
    await base.load('one', 10)
    await base.save('one', [{ eid: 'a', comps: { doc: { title: 'old' } } }], 10)
    let key = JSON.stringify(['opaque', null, true, true])
    let delayed = Promise.withResolvers<import('./answers.ts').SavedAnswer[]>()
    let entered = Promise.withResolvers<void>()
    let calls = 0
    let vault = {
      ...base,
      loadAnswers: () => {
        if (++calls !== 1) return Promise.resolve([])
        entered.resolve()
        return delayed.promise
      },
    }
    let { c, frame } = fixture({ epoch: 'one', wireVault: vault })
    let w = c.watch('opaque', server)
    await entered.promise
    let next: Promise<void> | undefined
    if (mode === 'empty') frame({ id: 's1', bundles: [] })
    if (mode === 'epoch') next = c.setEpoch('two')
    if (mode === 'close') c.close()
    delayed.resolve([{ key, members: [['a', true]], peers: [] }])
    await Promise.all([c.ready, next])
    assertEquals(w.value, [])
    assertEquals(c.ent('a'), undefined)
    assertEquals(w.ready, mode === 'empty')
    c.close()
  }
})

Deno.test('a restored projected answer cannot acquire another owners body coverage', async () => {
  let { c, frame } = fixture()
  let p = c.watch('projected', server)
  frame({ id: 's1', bundles: [row('a')], coverage: { a: { doc: ['title'] } } })
  let full = c.watch('full', server)
  frame({
    id: 's2',
    bundles: [{ ...row('a'), doc: { title: 'a', body: 'other owner' } }],
  })
  p.close()
  let again = c.watch('projected', server)
  assertEquals(ids(again.value), ['a'])
  full.close()
  assertEquals(c.cache.loaded('a', 'doc', 'body'), false)
  assertEquals(comp(c.ent('a'), 'doc').body, undefined)
  await c.cache.idle()
  c.close()
})

for (let disk of ['memory', 'indexedDB']) {
  Deno.test(
    'semantic vault bounds and epoch-conditional writes: ' + disk,
    async () => {
      let vault = disk === 'memory'
        ? wireStash()
        : wireIdb({ indexedDB: fakeDb() })
      let answer = {
        key: 'opaque',
        members: [['a', true] as [string, true]],
        peers: [],
      }
      await vault.load('one', 10)
      await vault.saveAnswers!('one', [answer], 1000)
      assertEquals(await vault.loadAnswers!('one', 1000), [answer])
      assertEquals(await vault.loadAnswers!('wrong', 1000), [])
      assertEquals(await vault.loadAnswers!('one', 0), [])
      await vault.load('two', 10)
      await vault.saveAnswers!('one', [answer], 1000)
      assertEquals(await vault.loadAnswers!('two', 1000), [])
      await vault.saveAnswers!(
        'two',
        [{ ...answer, key: 'x'.repeat(1000) }],
        100,
      )
      assertEquals(await vault.loadAnswers!('two', 100), [])
    },
  )
}

Deno.test('identity-only projections restore as members without invented loaded columns', async () => {
  let disk = wireStash()
  let { c, frame } = fixture({ wireVault: disk, epoch: 'boot' })
  await c.ready
  let w = c.watch('ids only', server)
  frame({ id: 's1', bundles: [{ entity: { eid: 'a' } }], coverage: { a: {} } })
  assertEquals(ids(w.value), ['a'])
  assertEquals(c.cache.loaded('a', 'doc', 'title'), false)
  w.close()
  await c.cache.idle()
  c.close()
  let next = fixture({ wireVault: disk, epoch: 'boot' }).c
  let cold = next.watch('ids only', server)
  await next.ready
  assertEquals(ids(cold.value), ['a'])
  assertEquals(cold.ready, false)
  assertEquals(next.cache.loaded('a', 'doc', 'title'), false)
  assertEquals(next.cache.loaded('a', 'created', 'at'), false)
  next.close()
})

Deno.test('authoritative departure does not drop another payload owners disk row', async () => {
  let disk = wireStash()
  let { c, frame } = fixture({ wireVault: disk, epoch: 'boot' })
  await c.ready
  c.watch('one', server)
  c.watch('two', server)
  frame({ id: 's1', bundles: [row('a')] })
  frame({ id: 's2', peers: [row('a')] })
  frame({ id: 's1', gone: ['a'] })
  await c.cache.idle()
  assertEquals((await disk.load('boot', 10)).map((r) => r.eid), ['a'])
  c.close()
})

Deno.test('one frame may give an eid two different projected role scopes', () => {
  let { c, frame } = fixture({ retention: 0 })
  let w = c.watch('both roles', server)
  frame({
    id: 's1',
    bundles: [row('a')],
    coverage: { a: { doc: ['title'] } },
    peers: [{ entity: { eid: 'a' }, doc: { body: 'rider' } }],
    peerCoverage: { a: { doc: ['body'] } },
  })
  assertEquals(ids(w.value), ['a'])
  assertEquals(comp(c.ent('a'), 'doc'), { title: 'a', body: 'rider' })
  frame({ id: 's1', gone: ['a'] })
  assertEquals(w.value, [])
  assertEquals(comp(c.ent('a'), 'doc'), { body: 'rider' })
  assertEquals(c.cache.loaded('a', 'doc', 'title'), false)
  assertEquals(c.cache.loaded('a', 'doc', 'body'), true)
  frame({ id: 's1', peerGone: ['a'] })
  assertEquals(c.ent('a'), undefined)
  c.close()
})

Deno.test('content deltas do not rewrite unchanged semantic answer checkpoints', async () => {
  let writes = 0
  let disk = wireStash()
  let { c, frame } = fixture({
    epoch: 'boot',
    wireVault: {
      ...disk,
      saveAnswers: (...args) => {
        writes++
        return disk.saveAnswers!(...args)
      },
    },
  })
  await c.ready
  c.watch('opaque', server)
  frame({ id: 's1', bundles: [row('a'), row('b')] })
  await c.cache.idle()
  assertEquals(writes, 1)
  frame({ id: 's1', bundles: [{ ...row('a'), doc: { title: 'edit' } }] })
  await c.cache.idle()
  assertEquals(writes, 1)
  frame({ id: 's1', bundles: [row('b'), row('a')], reset: true })
  await c.cache.idle()
  assertEquals(writes, 2)
  c.close()
})
