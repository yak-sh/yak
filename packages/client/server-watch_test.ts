/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { echo, type Frame, type Trouble } from '@yaks/sync'
import { client, type ClientOpts } from './client.ts'
import { box, comp, fakeDb, pair } from './testing.ts'
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
  let due: { ms: number; fn: () => void }[] = []
  let c = client(box, [], {
    url: 'http://box.test',
    vault: false,
    wireVault: false,
    connect: () => sockets.at(-1)!,
    timer: (fn, ms) => {
      due.push({ ms, fn })
    },
    report: (t) => {
      trouble.push(t)
    },
    fetch: () => Response.json([]),
    ...opts,
  })
  let frame = (frame: Frame) =>
    sockets.at(-1)!.emit('message', JSON.stringify(frame))
  // The close schedules its reconnect, the soonest of its timers.
  let reopen = () => {
    sockets.at(-1)!.close()
    sockets.push(pair().client)
    let [soonest] = due.sort((a, b) => a.ms - b.ms)
    due = []
    soonest?.fn()
    sockets.at(-1)!.emit('open')
  }
  return { c, frame, sockets, trouble, reopen }
}
let server = { evaluate: 'server' } as const

test('server evaluation never parses, filters or primes the query locally', async () => {
  let { c, frame, trouble } = fixture({ wireVault: wireStash() })
  // Even the first prime and later epoch hydration must not ask RAM to run
  // these opaque server contracts. This is a transport test, not proof that
  // the server supports a particular grammar or aggregate result shape.
  c.graph.storage.read = () => {
    throw new Error('local evaluation forbidden')
  }
  for (
    let query of [
      'café',
      '.near=a',
      '.requires->a',
      '.doc.title=unloaded&.fields=entity.eid',
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

// Each case owns its client; construction is not the watch behavior under test.
let membership = fixture()
let membershipWatch = membership.c.watch(
  '.recipe.cook.doc.title=unloaded',
  server,
)
membership.frame({ id: 's1', bundles: [row('hit')] })
test('server membership is authoritative even when fields/far targets are unloaded', () => {
  let { c } = membership
  let w = membershipWatch
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

test('replacement preserves server ranking; content deltas do not reorder', () => {
  let { c, frame } = fixture()
  let w = c.watch('.order=doc.title&.limit=2', server)
  frame({ id: 's1', bundles: [row('z'), row('a')] })
  assertEquals(ids(w.value), ['z', 'a']) // do not sort on incomplete local fields
  frame({ id: 's1', bundles: [row('a'), row('z')], reset: true })
  assertEquals(ids(w.value), ['a', 'z'])
  frame({ id: 's1', bundles: [row('a')] })
  assertEquals(ids(w.value), ['a', 'z'])
  let other = c.watch('.doc', server)
  frame({ id: 's2', bundles: [row('z')] })
  frame({ id: 's1', gone: ['z'] })
  assertEquals(ids(w.value), ['a'])
  assertEquals(ids(other.value), ['z'])
  assert(c.ent('z')) // leaving one answer cannot remove another owner's row
  c.close()
})

test('an aggregate watch carries its answer, and every later one', () => {
  let { c, frame } = fixture()
  let w = c.watch('.doc&.tally=doc.title', server)
  assertEquals(w.reduced, undefined)
  let heard = 0
  w.subscribe(() => heard++)
  frame({ id: 's1', tally: { a: 2, b: 1 } })
  assertEquals(w.reduced, { tally: { a: 2, b: 1 } })
  assertEquals([w.value, w.ready], [[], true])
  frame({ id: 's1', tally: { a: 3 } })
  assertEquals(w.reduced, { tally: { a: 3 } })
  assert(heard >= 2)
  let n = c.watch('.doc&.count', server)
  frame({ id: 's2', count: 0 })
  assertEquals(n.reduced, { count: 0 })
  c.close()
})

// Each case owns its client; construction is not the watch behavior under test.
let refusal = fixture()
test('a refused watch says why, until the server answers it', () => {
  let { c, frame } = refusal
  let w = c.watch('.nope', server)
  let heard = 0
  w.subscribe(() => heard++)
  frame({ id: 's1', refused: { error: 'Refused', message: 'no nope' } })
  assertEquals([w.refused, w.ready, heard], ['no nope', false, 1])
  frame({ id: 's1', bundles: [row('a')], reset: true })
  assertEquals([w.refused, w.ready], [undefined, true])
  c.close()
})

test('server watches dedupe and dispose independently from locally evaluated watches', () => {
  let { c, frame, sockets } = fixture()
  let a = c.watch('.doc', server)
  let b = c.watch('.doc', { ...server, remote: true })
  let local = c.watch('.doc')
  sockets[0].emit('open')
  assertEquals(
    sockets[0].sent.map((m) => {
      let sub = m as { subscribe: string; id: string }
      return { subscribe: sub.subscribe, id: sub.id }
    }),
    [
      { subscribe: '.doc', id: 's1' },
      { subscribe: '.doc', id: 's2' },
    ],
  )
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

// A server answer painted once, its readiness heard from then on.
let painted = fixture()
let paint = painted.c.watch('.near=somewhere', server)
painted.frame({ id: 's1', bundles: [row('old')] })
let states: boolean[] = []
paint.subscribe(() => states.push(paint.ready))
test('disconnect/refusal keep server paint but readiness awaits a successful reset', () => {
  let { c, frame, sockets, trouble, reopen } = painted
  let w = paint
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

// Prepare a persisted server answer once; reopening must only restore its IDs.
let reopenDisk = wireStash()
let reopening = fixture({ wireVault: reopenDisk, epoch: 'boot' })
await reopening.c.ready
let reopeningWatch = reopening.c.watch('café', server)
reopening.frame({ id: 's1', bundles: [row('hit')] })
await reopening.c.cache.idle()
let coldClient = fixture({ wireVault: reopenDisk, epoch: 'boot' }).c
let coldWatch = coldClient.watch('café', server)

test('server-only reopens restore bounded semantic membership without local matching', async () => {
  let { c } = reopening
  let w = reopeningWatch
  w.close()
  await c.cache.idle()
  let again = c.watch('café', server)
  assertEquals(ids(again.value), ['hit'])
  assertEquals(again.ready, false)
  assert(c.ent('hit')) // payload retention still works
  c.close()
  let next = coldClient
  let cold = coldWatch
  await next.ready
  assertEquals(ids(cold.value), ['hit'])
  assertEquals(cold.ready, false)
  assert(next.ent('hit'))
  next.close()
})

// Each case owns its client; construction is not the watch behavior under test.
let observerFixture = () => {
  let f = fixture({ retention: 0 })
  let seen: [string, boolean][] = []
  let stop = f.c.cache.onRows((eids) => {
    for (let eid of eids) seen.push([eid, !!f.c.ent(eid)])
  })
  let w = f.c.watch('.near=a', server)
  return { ...f, seen, stop, w }
}
let committedObserver = observerFixture()
let evictedObserver = observerFixture()
evictedObserver.frame({ id: 's1', bundles: [row('hit')] })

test('cache observers see committed rows', () => {
  let { c, frame, seen } = committedObserver
  frame({ id: 's1', bundles: [row('hit')] })
  assertEquals(seen, [['hit', true]])
  c.close()
})

test('cache observers see commits and physical eviction without tombstones or outbound writes', () => {
  let { c, frame, seen, stop, w } = evictedObserver
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

test('cache observers also see local-only commits and stop on client close', () => {
  let c = client(box, [], { vault: false, wireVault: false })
  let seen: string[][] = []
  c.cache.onRows((eids) => seen.push(eids))
  c.mutate([row('local')])
  assertEquals(seen, [['local']])
  c.close()
  c.graph.apply([row('after')])
  assertEquals(seen, [['local']])
})

test('server evaluation cannot silently become a local watch', () => {
  let local = client(box, [], { vault: false })
  assertThrows(() => local.watch('.doc', server), Error, 'requires a remote')
  local.close()
  let { c } = fixture()
  assertThrows(
    () => c.watch('.doc', { ...server, remote: false }),
    Error,
    'requires a remote',
  )
  c.close()
})

test('server evaluated synchronous first answers are visible before watch returns', () => {
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

let projection = fixture({ retention: 0 })

let whole = projection.c.watch('whole', server)
projection.frame({
  id: 's1',
  bundles: [{
    ...row('a'),
    doc: { title: 'a', body: 'body' },
    recipe: { serves: 4 },
  }],
})
let projected = projection.c.watch('projection', server)

test('projected/full owners share fields, and departures unload only the released scope', () => {
  let { c, frame, trouble } = projection
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

// One owner projects `a`'s body; another watches the whole of it.
let owners = () => {
  let f = fixture()
  let p = f.c.watch('body', server)
  f.frame({
    id: 's1',
    bundles: [{ entity: { eid: 'a' }, doc: { body: 'kept' } }],
    coverage: { a: { doc: ['body'] } },
  })
  f.c.watch('whole', server)
  return { ...f, p }
}

let omitted = owners()
test('omission cannot erase another projected owner', () => {
  let { c, frame } = omitted
  frame({ id: 's2', bundles: [row('a')] })
  assertEquals(comp(c.ent('a'), 'doc').body, 'kept')
  c.close()
})

let nulled = owners()
nulled.frame({ id: 's2', bundles: [row('a')] })
test('explicit null is authoritative over another projected owner', () => {
  let { c, frame, p } = nulled
  frame({
    id: 's2',
    bundles: [{ ...row('a'), doc: { title: 'a', body: null } }],
  })
  assertEquals(comp(c.ent('a'), 'doc').body, undefined)
  p.close()
  assertEquals(c.cache.loaded('a', 'doc', 'body'), true)
  c.close()
})

test('opt-in one-shot properties retain paint, not coverage, within the row budget', () => {
  let { c, frame } = fixture({ retention: 1, retainUnownedProps: true })
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
  assertEquals(comp(c.ent('a'), 'doc').body, undefined)
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

// Each case owns its client; construction is not the watch behavior under test.
let bodyFixture = () => {
  let f = fixture()
  f.c.watch('bodyless', server)
  f.frame({
    id: 's1',
    bundles: [{ ...row('a'), doc: { title: 'a', body: 'old' } }],
  })
  return f
}
let bodyless = bodyFixture()
let covered = bodyFixture()
covered.frame({
  id: 's1',
  bundles: [row('a')],
  coverage: { a: { doc: ['title'] } },
  reset: true,
})

test('body omission is unloaded while covered omission is a known absence', () => {
  let { c, frame } = bodyless
  frame({
    id: 's1',
    bundles: [row('a')],
    coverage: { a: { doc: ['title'] } },
    reset: true,
  })
  assertEquals(comp(c.ent('a'), 'doc').body, undefined)
  assertEquals(c.cache.loaded('a', 'doc', 'body'), false)
  c.close()
})

test('a covered omission is a known absence', () => {
  let { c, frame } = covered
  assertEquals(comp(c.ent('a'), 'doc').body, undefined)
  assertEquals(c.cache.loaded('a', 'doc', 'body'), false)
  frame({
    id: 's1',
    bundles: [{ entity: { eid: 'a' }, doc: {} }],
    coverage: { a: { doc: ['title'] } },
  })
  assertEquals(comp(c.ent('a'), 'doc').title, undefined)
  assertEquals(c.cache.loaded('a', 'doc', 'title'), true)
  c.close()
})

let riders = fixture({ retention: 0 })
let riderWatch = riders.c.watch('riders', server)
riders.frame({
  id: 's1',
  peers: [{ ...row('peer'), doc: { title: 'peer', body: 'rider' } }],
})
riders.c.watch('also rider', server)
riders.frame({ id: 's2', peers: [row('peer')] })

test('a rider is answered and held, never a member; each role releases independently', () => {
  let { c } = riders
  // Readiness came from the socket; role releases use the replica door.
  let frame = c.cache.land
  let w = riderWatch
  assertEquals(ids(w.value), ['peer'])
  assertEquals(w.ready, true)
  assert(c.ent('peer'))
  assertEquals(c.cache.includes('s1', 'peer'), true)
  assertEquals(c.cache.loaded('peer', 'recipe', 'serves'), false)
  frame({ id: 's1', peerGone: ['peer'] })
  assert(c.ent('peer'))
  assertEquals(comp(c.ent('peer'), 'doc').body, undefined)
  c.close()
})

let roles = fixture({ retention: 0 })
let roleWatch = roles.c.watch('member and rider', server)
roles.frame({ id: 's1', peers: [row('peer')] })

test('a member departure leaves its rider until the authoritative reset', () => {
  let { c } = roles
  let frame = c.cache.land
  frame({ id: 's1', bundles: [row('peer')] })
  frame({ id: 's1', gone: ['peer'] })
  assertEquals(ids(roleWatch.value), ['peer']) // it still rides
  assert(c.ent('peer'))
  frame({ id: 's1', reset: true, bundles: [] })
  assertEquals(c.ent('peer'), undefined)
  c.close()
})

let peers = fixture({ retention: 0 })

peers.c.watch('riders', server)
peers.frame({ id: 's1', peers: [row('a'), row('b')] })
peers.c.watch('member', server)
peers.frame({
  id: 's2',
  bundles: [{ ...row('a'), doc: { title: 'a', body: 'full' } }],
})
let releasePeers = peers.c.cache.protect(['b'])

test('peer reset, full member overlap and pending pins survive independent releases', () => {
  let { c, frame } = peers
  let release = releasePeers
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
  test(
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
      next.c.graph.storage.read = () => {
        throw new Error('local matching forbidden')
      }
      let reopen = next.c.watch('opaque ranking', server)
      await next.c.ready
      assertEquals(ids(reopen.value), ['b', 'a', 'peer'])
      assertEquals(reopen.ready, false)
      assert(next.c.ent('peer'))
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

test('answer metadata bounds include empty answers, long keys and coverage; eviction never invents hits', () => {
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

let retaining = fixture({ retention: 0 })
let retained = retaining.c.watch('opaque', server)
retaining.frame({ id: 's1', bundles: [row('a')] })
test('retained membership never restores evicted payloads or crosses semantic options', () => {
  let { c, frame } = retaining
  retained.close()
  assertEquals(c.watch('opaque', server).value, [])
  frame({ id: 's2', bundles: [row('a')] })
  assertEquals(c.watch('opaque', { ...server, now: 123 }).value, [])
  c.close()
})

test('late answer hydration cannot revive an empty reply or an obsolete epoch', async () => {
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

// A projected owner of `a`'s title, and a full owner that loaded its body.
let restoring = fixture()
let restoredProjection = restoring.c.watch('projected', server)
restoring.frame({
  id: 's1',
  bundles: [row('a')],
  coverage: { a: { doc: ['title'] } },
})
let restoredFull = restoring.c.watch('full', server)
restoring.frame({
  id: 's2',
  bundles: [{ ...row('a'), doc: { title: 'a', body: 'other owner' } }],
})
test('a restored projected answer cannot acquire another owners body coverage', async () => {
  let { c } = restoring
  let p = restoredProjection
  let full = restoredFull
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
  test(
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

// An identity-only answer: a member with no properties covered.
let identities = (
  { c, frame }: ReturnType<typeof fixture>,
) => {
  let w = c.watch('ids only', server)
  frame({ id: 's1', bundles: [{ entity: { eid: 'a' } }], coverage: { a: {} } })
  return w
}
let identifying = fixture({ wireVault: wireStash(), epoch: 'boot' })
await identifying.c.ready
test('identity-only projections are members without invented loaded properties', () => {
  let { c } = identifying
  let w = identities(identifying)
  assertEquals(ids(w.value), ['a'])
  assertEquals(c.cache.loaded('a', 'doc', 'title'), false)
  c.close()
})

// Persist that answer once; the restore reads it back.
let identityDisk = wireStash()
let persisting = fixture({ wireVault: identityDisk, epoch: 'boot' })
await persisting.c.ready
identities(persisting).close()
await persisting.c.cache.idle()
persisting.c.close()
test('identity-only projections restore as members without invented loaded properties', async () => {
  let next = fixture({ wireVault: identityDisk, epoch: 'boot' }).c
  let cold = next.watch('ids only', server)
  await next.ready
  assertEquals(ids(cold.value), ['a'])
  assertEquals(cold.ready, false)
  assertEquals(next.cache.loaded('a', 'doc', 'title'), false)
  assertEquals(next.cache.loaded('a', 'created', 'at'), false)
  next.close()
})

let departureDisk = wireStash()
let departure = fixture({ wireVault: departureDisk, epoch: 'boot' })
await departure.c.ready
departure.c.watch('one', server)
departure.c.watch('two', server)
departure.frame({ id: 's1', bundles: [row('a')] })
departure.frame({ id: 's2', peers: [row('a')] })

test('authoritative departure does not drop another payload owners disk row', async () => {
  let { c, frame } = departure
  let disk = departureDisk
  frame({ id: 's1', gone: ['a'] })
  await c.cache.idle()
  assertEquals((await disk.load('boot', 10)).map((r) => r.eid), ['a'])
  c.close()
})

test('one frame may give an eid two different projected role scopes', () => {
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
  assertEquals(w.value, [{ entity: { eid: 'a' }, doc: { body: 'rider' } }])
  assertEquals(c.cache.loaded('a', 'doc', 'title'), false)
  assertEquals(c.cache.loaded('a', 'doc', 'body'), true)
  frame({ id: 's1', peerGone: ['a'] })
  assertEquals(c.ent('a'), undefined)
  c.close()
})

// Each checkpoint case starts with one persisted answer, prepared once.
let checkpoint = async (edited = false) => {
  let writes = 0
  let disk = wireStash()
  let { c } = fixture({
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
  c.cache.land({ id: 's1', bundles: [row('a'), row('b')] })
  await c.cache.idle()
  if (edited) {
    c.cache.land({
      id: 's1',
      bundles: [{ ...row('a'), doc: { title: 'edit' } }],
    })
    await c.cache.idle()
  }
  return {
    c,
    get writes() {
      return writes
    },
  }
}
let checkpoints = await checkpoint()
let reorderedCheckpoint = await checkpoint(true)

test('content deltas do not rewrite unchanged semantic answer checkpoints', async () => {
  let { c } = checkpoints
  assertEquals(checkpoints.writes, 1)
  c.cache.land({ id: 's1', bundles: [{ ...row('a'), doc: { title: 'edit' } }] })
  await c.cache.idle()
  assertEquals(comp(c.ent('a'), 'doc').title, 'edit')
  assertEquals(checkpoints.writes, 1)
  c.close()
})

test('a ranking reset rewrites its semantic answer checkpoint', async () => {
  let { c } = reorderedCheckpoint
  assertEquals(reorderedCheckpoint.writes, 1)
  c.cache.land({
    id: 's1',
    bundles: [row('b'), { ...row('a'), doc: { title: 'edit' } }],
    reset: true,
  })
  await c.cache.idle()
  assertEquals(reorderedCheckpoint.writes, 2)
  c.close()
})
