// No stale rows (D-475): a page holds each row at the revision it came from,
// and a frame older than a row it touches, or one whose subscription missed a
// frame, does not land: that subscription is asked again, whole. The frames
// here are said by hand, as a door over several stores says them, each store
// on its own socket, so they can arrive in any order.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Frame, Trouble } from '@yaks/sync'
import { client, type ClientOpts } from './client.ts'
import { WriteRefused } from './mod.ts'
import { box, comp, type Fake, pair } from './testing.ts'

let dal = (serves: number): Bundle => ({
  entity: { eid: 'dal' },
  recipe: { serves },
})

// A page whose server is said by hand: `say` delivers a frame on the open
// socket, `asked` counts how often a subscription was asked for, and `drop`
// loses the socket and opens the next.
let page = (opts: ClientOpts = {}) => {
  let sockets: Fake[] = []
  let due: { ms: number; fn: () => void }[] = []
  let trouble: Trouble[] = []
  let c = client(box, [], {
    url: 'http://box.test',
    vault: false,
    wireVault: false,
    connect: () => {
      let s = pair().client
      sockets.push(s)
      return s
    },
    timer: (fn, ms) => void due.push({ ms, fn }),
    report: (t) => void trouble.push(t),
    fetch: () => Response.json([]),
    ...opts,
  })
  let open = () => sockets.at(-1)!.emit('open')
  let say = (frame: Frame) =>
    sockets.at(-1)!.emit('message', JSON.stringify(frame))
  let asked = (id: string) =>
    sockets.flatMap((s) => s.sent).filter((m) =>
      (m as { subscribe?: unknown; id?: string }).subscribe !== undefined &&
      (m as { id?: string }).id == id
    ).length
  // The close sets its reconnect, the soonest of its timers.
  let drop = () => {
    sockets.at(-1)!.close()
    let [soonest] = due.sort((a, b) => a.ms - b.ms)
    due = []
    soonest?.fn()
    open()
  }
  let serves = (eid = 'dal') => comp(c.ent(eid), 'recipe').serves
  return { c, open, say, asked, drop, serves, trouble }
}

test('a frame older than a row it touches does not land, and its subscription is asked again', () => {
  let p = page()
  p.c.watch('.recipe')
  p.c.watch('.recipe.serves>1')
  p.open()
  p.say({ id: 's1', revision: 10, bundles: [dal(4)] })
  p.say({ id: 's2', revision: 9, bundles: [dal(2)] })
  equal(p.serves(), 4)
  equal(p.asked('s2'), 2)
  // Until its answer, what was on its way before the asking is let go.
  p.say({ id: 's2', revision: 11, since: 9, bundles: [dal(1)] })
  equal(p.serves(), 4)
  p.say({ id: 's2', revision: 12, bundles: [dal(5)] })
  equal(p.serves(), 5)
  equal(p.trouble, [])
  p.c.close()
})

test('a frame whose subscription missed one asks it again, whole, and says so', () => {
  let p = page()
  p.c.watch('.recipe')
  p.open()
  p.say({ id: 's1', revision: 10, bundles: [dal(4)] })
  p.say({ id: 's1', revision: 12, since: 11, bundles: [dal(6)] })
  equal(p.serves(), 4)
  equal(p.asked('s1'), 2)
  equal(p.trouble.length, 1)
  p.say({ id: 's1', revision: 13, bundles: [dal(6)] })
  equal(p.serves(), 6)
  p.c.close()
})

test('stores are compared on the revisions both name, never across', () => {
  let p = page()
  p.c.watch('.recipe')
  p.c.watch('.recipe.serves>1')
  p.open()
  p.say({ id: 's1', revision: { 'me/books': 10 }, bundles: [dal(4)] })
  p.say({ id: 's2', revision: { 'me/loans': 3 }, bundles: [dal(3)] })
  equal(p.serves(), 3)
  p.say({
    id: 's2',
    revision: { 'me/books': 9, 'me/loans': 4 },
    since: { 'me/loans': 3 },
    bundles: [dal(2)],
  })
  equal(p.serves(), 3)
  equal(p.asked('s2'), 2)
  p.c.close()
})

test('after a reconnect mid-write, the page holds its write and no older copy', async () => {
  let reply = Promise.withResolvers<Response>()
  let p = page({ fetch: () => reply.promise })
  p.c.watch('.recipe')
  p.c.watch('.recipe.serves>1')
  p.open()
  p.say({ id: 's1', revision: 10, bundles: [dal(2)] })
  let written = p.c.mutate([dal(4)])
  equal(p.serves(), 4)
  p.drop()
  equal(p.asked('s1'), 2)
  p.say({ id: 's1', revision: 12, bundles: [dal(4)] })
  reply.resolve(Response.json([dal(4)]))
  await written
  // Another store's socket, read before the write, answers late.
  p.say({ id: 's2', revision: 9, bundles: [dal(2)] })
  equal(p.serves(), 4)
  equal(p.asked('s2'), 3)
  p.c.close()
})

test('two tabs writing one row both end on the later write', async () => {
  let a = page({ fetch: () => Response.json([dal(5)]) })
  let b = page({ fetch: () => Response.json([dal(6)]) })
  for (let tab of [a, b]) {
    tab.c.watch('.recipe')
    tab.c.watch('.recipe.serves>1')
    tab.open()
    tab.say({ id: 's1', revision: 19, bundles: [dal(2)] })
  }
  await a.c.mutate([dal(5)])
  await b.c.mutate([dal(6)])
  for (let tab of [a, b]) {
    tab.say({ id: 's1', revision: 20, since: 19, bundles: [dal(5)] })
    tab.say({ id: 's1', revision: 21, since: 20, bundles: [dal(6)] })
    // The other subscription heard the first write only, and late.
    tab.say({ id: 's2', revision: 20, bundles: [dal(5)] })
    equal(tab.serves(), 6)
    tab.c.close()
  }
})

test('a row whose permission was revoked while watched is not brought back by an older answer', () => {
  let p = page()
  let w = p.c.watch('.recipe')
  p.c.watch('.recipe.serves>1')
  p.open()
  p.say({ id: 's1', revision: 30, bundles: [dal(2)] })
  equal(w.value.length, 1)
  p.say({ id: 's1', revision: 31, since: 30, gone: ['dal'] })
  p.say({ id: 's2', revision: 30, bundles: [dal(2)] })
  equal(p.serves(), undefined)
  equal(w.value, [])
  equal(p.asked('s2'), 2)
  p.c.close()
})

test('a refused write reverts, and the subscription that heard a newer row meanwhile is asked again', async () => {
  let p = page({
    fetch: () =>
      Response.json({ error: 'Refused', message: 'not a writer' }, {
        status: 403,
      }),
  })
  p.c.watch('.recipe')
  p.open()
  p.say({ id: 's1', revision: 40, bundles: [dal(2)] })
  let written = Promise.resolve(p.c.mutate([dal(9)]))
  equal(p.serves(), 9)
  p.say({ id: 's1', revision: 41, since: 40, bundles: [dal(3)] })
  await assertRejects(() => written, WriteRefused)
  equal(p.asked('s1'), 2)
  p.say({ id: 's1', revision: 42, bundles: [dal(3)] })
  equal(p.serves(), 3)
  p.c.close()
})

test('a row deleted elsewhere is not brought back by an answer read before', () => {
  let p = page()
  p.c.watch('.recipe')
  p.c.watch('.recipe.serves>1')
  p.open()
  p.say({ id: 's1', revision: 50, bundles: [dal(2)] })
  p.say({
    id: 's1',
    revision: 51,
    since: 50,
    bundles: [{ entity: { eid: 'dal' }, tombstone: {} }],
  })
  p.say({ id: 's2', revision: 50, bundles: [dal(2)] })
  equal(p.serves(), undefined)
  equal(p.asked('s2'), 2)
  p.c.close()
})

test('a row evicted under the bound keeps its revision, so an older answer cannot bring it back', () => {
  let p = page({ retention: 1 })
  let w = p.c.watch('.recipe')
  p.open()
  p.say({
    id: 's1',
    revision: 60,
    bundles: [dal(2), { entity: { eid: 'soup' }, recipe: { serves: 1 } }],
  })
  w.close()
  equal([p.c.ent('dal'), p.c.ent('soup')].filter(Boolean).length, 1)
  p.c.watch('.recipe.serves>1')
  p.say({ id: 's2', revision: 59, bundles: [dal(1)] })
  equal(p.asked('s2'), 2)
  p.say({ id: 's2', revision: 61, bundles: [dal(2)] })
  equal(p.serves(), 2)
  p.c.close()
})

test('an accepted write whose own row was heard meanwhile asks nothing again', async () => {
  let p = page({ fetch: () => Response.json([dal(9)]) })
  p.c.watch('.recipe')
  p.open()
  p.say({ id: 's1', revision: 70, bundles: [dal(2)] })
  let written = p.c.mutate([dal(9)])
  p.say({ id: 's1', revision: 71, since: 70, bundles: [dal(9)] })
  await written
  equal(p.serves(), 9)
  equal(p.asked('s1'), 1)
  p.c.close()
})
