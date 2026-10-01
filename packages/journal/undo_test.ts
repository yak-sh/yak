/// <reference lib="deno.ns" />
// Walking a batch backwards: what an undo restores, what it refuses, and the
// fact that an undo is an ordinary write — journaled in its turn, so undoing
// it again is a redo.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { edgeEid } from '@yaks/edge'
import { type Bundle, type Comp, Stale } from '@yaks/graph'
import { applied, Final, undo, undone } from './undo.ts'
import { sync, wikiGraph } from './testing.ts'

let fixture = () => {
  let { g, j } = wikiGraph()
  return {
    g,
    j,
    apply: (change: Bundle[]) => sync(g.apply(change)),
    back: (seq: number, by?: string) =>
      sync(undo(g, j)(seq, by ? { by } : undefined)),
    page: (eid: string) =>
      (sync(g.read('.kind=page')).find((b) => b.entity.eid == eid)
        ?.page ?? null) as Comp | null,
    get: (eid: string) => sync(g.get([eid]))[0],
    // An entity as it reads, but for the stamps a write leaves on it.
    held: (eid: string) => {
      let { created: _c, updated: _u, ...rest } = sync(g.get([eid]))[0]
      return rest
    },
    cite: (from: string, to: string) => edgeEid(from, 'cites', to),
  }
}

test('undo of a patch restores the property it moved', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  f.back(2, 'ada')
  assertEquals(f.page('p1')?.title, 'Kickoff')
})

test('an event beside a write is not history, so undo restores the write', () => {
  let f = fixture()
  let read = (title: string, by: string) =>
    f.apply([{ entity: { eid: 'p1' }, page: { title }, read: { by } }])
  read('Kickoff', 'bo')
  read('Retro', 'ada')
  f.back(2)
  assertEquals(f.page('p1')?.title, 'Kickoff')
})

test('an undo is itself in history, with its own actor', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  f.back(2, 'ada')
  let past = f.j.history('p1')
  assertEquals(past.map((b) => b.seq), [1, 2, 3])
  assertEquals(past[2].by, 'ada')
  assertEquals(past[2].deltas.map((d) => `${d.before}→${d.after}`), [
    'Retro→Kickoff',
  ])
})

test('undoing an undo is a redo', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  f.back(2)
  f.back(3)
  assertEquals(f.page('p1')?.title, 'Retro')
})

test('undo of a create drops the component it brought', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.back(1)
  assertEquals(f.page('p1'), null)
})

test('an undo guards every property it restores', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' } }])
  let [back] = undone(f.j.at(2)!, { guard: true })
  assertEquals(back.page, { title: 'One' })
  // The guard names the value the batch left, so a property somebody else has
  // moved since refuses the reversal instead of clobbering it.
  assert(back.$was?.page?.title)
})

test('undo of a delete brings the entity back as it was', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff', text: 'b' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  let was = f.held('p1')
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  f.back(3)
  assertEquals(f.held('p1'), was)
})

test('undo of a delete brings back what it cascaded, edges included', () => {
  let f = fixture()
  f.apply([
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
    { entity: { eid: 'p2' }, page: { title: 'Retro', parent: 'p1' } },
    { entity: { eid: 'p2' }, pin: { page: 'p1' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
    { entity: { eid: '$c' }, edge: { from: 'p2', to: 'p1' }, cites: {} },
  ])
  let whole = () => ['p1', 'p2', 'n1', f.cite('p2', 'p1')].map(f.held)
  let was = whole()
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertEquals(f.get('p2').pin, undefined)
  f.back(2)
  assertEquals(whole(), was)
})

test('undoing an undone delete deletes it again', () => {
  let f = fixture()
  f.apply([
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  f.back(2)
  f.back(3)
  assertEquals([f.get('p1').tombstone, f.get('n1').tombstone], [{}, {}])
})

test('an undone delete is refused if the entity came back with other values', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Again' } }])
  assertThrows(() => f.back(2), Stale)
  assertEquals(f.page('p1')?.title, 'Again')
})

test('an entity the journal recorded nothing of cannot come back', () => {
  let died = {
    target: 'p1',
    comp: 'tombstone',
    prop: null,
    before: null,
    after: {},
  }
  let batch = { seq: 4, at: '', by: null, via: null, deltas: [died] }
  assertThrows(() => undone(batch), Final, 'p1 was deleted in batch #4')
})

test('undo of a batch that never happened says so', () => {
  let f = fixture()
  assertThrows(() => f.back(9), Error, 'no journal batch #9')
})

test('applied() rebuilds the batch as committed', () => {
  let f = fixture()
  f.apply([
    { entity: { eid: 'p1' }, page: { title: 'Kickoff', text: 'body' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ])
  assertEquals(applied(f.j.at(1)!), [
    { entity: { eid: 'p1' }, page: { title: 'Kickoff', text: 'body' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ])
})

test('applied() rebuilds a death as a death', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertEquals(applied(f.j.at(2)!), [{ entity: { eid: 'p1' }, $delete: true }])
})

// A log written elsewhere can hold a patch to the spine — the fleet's own
// journal recorded `entity{num}` rows and the import carried them over. The
// spine is the bundle's identity, so such a patch merges into `entity` rather
// than landing on top of the eid.
test('a recorded spine patch merges into the identity', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.j.write({ at: '2026-01-02T00:00:00.000Z' }, [
    { target: 'p1', comp: 'entity', value: { num: 7 } },
    { target: 'p1', comp: 'page', value: { title: 'Retro' } },
  ])
  assertEquals(applied(f.j.at(2)!), [
    { entity: { eid: 'p1', num: 7 }, page: { title: 'Retro' } },
  ])
})
