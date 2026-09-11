/// <reference lib="deno.ns" />
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { echo, type Frame, type Trouble } from '@yaks/sync'
import { client, type ClientOpts } from './client.ts'
import { box, comp, pair } from './harness.ts'
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

Deno.test('server-only reopens do not invent membership from retained or restored payloads', async () => {
  let disk = wireStash()
  let { c, frame } = fixture({ wireVault: disk, epoch: 'boot' })
  await c.ready
  let w = c.watch('café', server)
  frame({ id: 's1', bundles: [row('hit')] })
  w.close()
  await c.cache.idle()
  let again = c.watch('café', server)
  assertEquals(again.value, []) // no persisted semantic answer yet
  assertEquals(again.ready, false)
  assert(c.ent('hit')) // payload retention still works
  c.close()
  let next = fixture({ wireVault: disk, epoch: 'boot' }).c
  let cold = next.watch('café', server)
  await next.ready
  assertEquals(cold.value, [])
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
