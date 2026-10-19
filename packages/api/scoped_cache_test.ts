/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { type Graph, graph } from '@yaks/graph'
import { personal } from '@yaks/member'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { type Frame, subscriptions } from './subs.ts'
import { client } from '../client/client.ts'
import { pair } from '../sync/testing.ts'

let vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { price: { type: 'number' } } },
    preference: {
      component: true,
      properties: { color: { type: 'string' } },
    },
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity' } },
    },
    label: { component: true, properties: { text: { type: 'string' } } },
    draft: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        text: { type: 'string' },
      },
    },
  },
})
let fixture = (only?: string, references = false) => {
  let g = graph({ vocab, storage: ram(vocab) })
  g.use(personal(vocab, { draft: 'by', preference: 'entity' }))
  let seed = [
    {
      entity: { eid: 'alice' },
      book: { price: 1 },
      preference: { color: 'red' },
    },
    {
      entity: { eid: 'bob' },
      book: { price: 2 },
      preference: { color: 'blue' },
    },
    {
      entity: { eid: 'secret' },
      book: { price: 3 },
      draft: { by: 'alice', text: 'unsent' },
    },
  ]
  g.apply(only ? seed.filter((b) => b.entity.eid === only) : seed, {
    trusted: true,
  })
  if (references) {
    g.apply([
      { entity: { eid: 'target' }, label: { text: 'public' } },
      { entity: { eid: 'alice' }, link: { to: 'target' } },
    ], { trusted: true })
  }
  let reads = 0
  let spy: Graph = { ...g, read: (q, opts) => (reads++, g.read(q, opts)) }
  let subs = subscriptions(spy)
  let ear = () => {
    let frames: Frame[] = []
    return { sink: (f: Frame) => frames.push(f), take: () => frames.splice(0) }
  }
  return { g, subs, ear, reads: () => reads }
}
let reused = fixture()
let windowed = (() => {
  let { g, subs, ear, reads } = fixture('bob'), alice = ear(), bob = ear()
  let query = '.book&?preference&.order=book.price&.limit=10'
  subs.open(alice.sink, 'window', query, { person: 'alice' })
  subs.open(bob.sink, 'window', query, { person: 'bob' })
  alice.take()
  bob.take()
  return { g, reads, alice, bob }
})()
test('underfilled windows filter commit facts for each caller before delivering', () => {
  let { g, reads, alice, bob } = windowed
  let before = reads()
  g.apply([{
    entity: { eid: 'bob' },
    book: { price: 4 },
    preference: { color: 'changed' },
  }], { trusted: true })
  equal(reads(), before)
  equal(alice.take()[0].bundles, [{
    entity: { eid: 'bob' },
    book: { price: 4 },
  }])
  equal(bob.take()[0].bundles, [{
    entity: { eid: 'bob' },
    book: { price: 4 },
    preference: { color: 'changed' },
  }])
})
test('a person reopens a retained query without reading its unchanged rows', () => {
  let { subs, ear, reads } = reused, first = ear(), next = ear()
  subs.open(first.sink, 'books', '.book&*', { person: 'bob' })
  let answer = first.take()
  subs.drop(first.sink)
  let before = reads()
  subs.open(next.sink, 'books', '.book&*', { person: 'bob' })
  equal(reads(), before)
  equal(next.take(), answer)
})
let separate = fixture()
test('shared query answers stay separate for each person', () => {
  let { subs, ear } = separate, alice = ear(), bob = ear()
  subs.open(alice.sink, 'books', '.book&*', { person: 'alice' })
  subs.open(bob.sink, 'books', '.book&*', { person: 'bob' })
  let owned = JSON.stringify(alice.take()), foreign = JSON.stringify(bob.take())
  equal(owned.includes('unsent'), true)
  equal(foreign.includes('unsent'), false)
  equal(foreign.includes('red'), false)
  equal(foreign.includes('blue'), true)
})
// An answer bob opened and dropped, retained for his next open.
let retain = (only?: string, references = false) => {
  let f = fixture(only, references), first = f.ear()
  f.subs.open(first.sink, 'books', '.book&*', { person: 'bob' })
  f.subs.drop(first.sink)
  return f
}
let moved = retain()
test('a retained scoped answer follows trusted ownership changes', () => {
  let { g, subs, ear } = moved, next = ear()
  g.apply([{ entity: { eid: 'secret' }, draft: { by: 'bob' } }], {
    trusted: true,
  })
  subs.open(next.sink, 'books', '.book&*', { person: 'bob' })
  equal(JSON.stringify(next.take()).includes('unsent'), true)
})
let enclosed = retain()
test('a retained scoped answer removes public rows made private by the server', () => {
  let { g, subs, ear } = enclosed, next = ear()
  g.apply([{
    entity: { eid: 'alice' },
    draft: { by: 'alice', text: 'private' },
  }], {
    trusted: true,
  })
  subs.open(next.sink, 'books', '.book&*', { person: 'bob' })
  equal(next.take()[0].bundles?.map((b) => b.entity.eid), ['bob'])
})
let changed = fixture('alice')
let changedFirst = changed.ear(), changedNext = changed.ear()
changed.subs.open(changedFirst.sink, 'books', '.book&*', { person: 'bob' })
changedFirst.take()
test('routed scoped answers mask foreign aspects before updating the cache', () => {
  let { g, subs, reads } = changed, first = changedFirst, next = changedNext
  g.apply([{
    entity: { eid: 'alice' },
    preference: { color: 'hidden-update' },
  }], {
    trusted: true,
  })
  equal(JSON.stringify(first.take()).includes('hidden-update'), false)
  subs.drop(first.sink)
  let before = reads()
  subs.open(next.sink, 'books', '.book&*', { person: 'bob' })
  equal(reads(), before)
  equal(JSON.stringify(next.take()).includes('hidden-update'), false)
})
let predicate = fixture('alice')
test('foreign personal aspects cannot enter routed query membership', () => {
  let { g, subs, ear, reads } = predicate, first = ear(), next = ear()
  subs.open(first.sink, 'red', '.preference.color=red&*', { person: 'bob' })
  first.take()
  g.apply([{ entity: { eid: 'alice' }, book: { price: 4 } }], { trusted: true })
  equal(first.take(), [])
  subs.drop(first.sink)
  let before = reads()
  subs.open(next.sink, 'red', '.preference.color=red&*', { person: 'bob' })
  equal(reads(), before)
  equal(next.take()[0].bundles, [])
})

let linked = fixture('alice', true), linkedEar = linked.ear()
let socket = pair().client
let browser = client(vocab, [], {
  url: 'http://box.test',
  vault: false,
  wireVault: false,
  connect: () => socket,
  timer: () => {},
  report: (error) => {
    throw error
  },
})
await browser.ready
let watched = browser.watch('.entity.eid=alice&*', { evaluate: 'server' })
let deliver = (frame: Frame) =>
  socket.emit('message', JSON.stringify({ ...frame, id: 's1' }))
linked.subs.open(linkedEar.sink, 'link', '.entity.eid=alice&*', {
  person: 'bob',
})
deliver(linkedEar.take()[0])
let publicLink = watched.value[0].link
linked.g.apply([{
  entity: { eid: 'target' },
  draft: { by: 'alice', text: 'private' },
}], { trusted: true })
test('an active scoped answer masks a reference when its target becomes private', async () => {
  equal((publicLink as { to: string }).to, 'target')
  let frame = linkedEar.take()[0]
  // Stored-query frames carry whole rows, not patches. Omitting a covered
  // property must clear its former public value in the real client as well.
  equal(frame.bundles?.[0].link, {})
  equal(frame.coverage, undefined)
  deliver(frame)
  equal(watched.value[0].link, {})
  equal((await browser.graph.get(['alice']))[0].link, {})
  browser.close()
})
let closedLink = fixture('alice', true)
let closedFirst = closedLink.ear(), closedNext = closedLink.ear()
closedLink.subs.open(closedFirst.sink, 'link', '.link.to=target&*', {
  person: 'bob',
})
let closedAnswer = closedFirst.take()
closedLink.subs.drop(closedFirst.sink)
closedLink.g.apply([{
  entity: { eid: 'target' },
  draft: { by: 'alice', text: 'private' },
}], { trusted: true })
test('a retained reference query loses membership when its target becomes private', () => {
  let { subs } = closedLink, next = closedNext
  equal(closedAnswer[0].bundles?.map((b) => b.entity.eid), ['alice'])
  subs.open(next.sink, 'link', '.link.to=target&*', { person: 'bob' })
  equal(next.take()[0].bundles, [])
})
