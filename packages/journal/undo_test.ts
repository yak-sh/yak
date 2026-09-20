/// <reference lib="deno.ns" />
// Walking a batch backwards: what an undo restores, what it refuses, and the
// fact that an undo is an ordinary write — journaled in its turn, so undoing
// it again is a redo.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { applied, Final, undo, undone } from './undo.ts'
import { sync, wikiGraph } from './harness.ts'

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
  }
}

Deno.test('undo of a patch restores the column it moved', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  f.back(2, 'ada')
  assertEquals(f.page('p1')?.title, 'Kickoff')
})

Deno.test('an undo is itself in history, with its own actor', () => {
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

Deno.test('undoing an undo is a redo', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  f.back(2)
  f.back(3)
  assertEquals(f.page('p1')?.title, 'Retro')
})

Deno.test('undo of a create drops the component it brought', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.back(1)
  assertEquals(f.page('p1'), null)
})

Deno.test('an undo guards every column it restores', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' } }])
  let [back] = undone(f.j.at(2)!, { guard: true })
  assertEquals(back.page, { title: 'One' })
  // The guard names the value the batch LEFT, so a column somebody else has
  // moved since refuses the reversal instead of clobbering it.
  assert(back.$was?.page?.title)
})

Deno.test('undo of a delete is refused — death is final', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  let err = assertThrows(() => f.back(2), Final)
  assertEquals(
    (err as Final).message,
    'p1 was deleted in batch #2 — a death cannot be undone',
  )
})

Deno.test('undo of a batch that never happened says so', () => {
  let f = fixture()
  assertThrows(() => f.back(9), Error, 'no journal batch #9')
})

Deno.test('applied() rebuilds the batch as committed', () => {
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

Deno.test('applied() rebuilds a death as a death', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertEquals(applied(f.j.at(2)!), [{ entity: { eid: 'p1' }, $delete: true }])
})

// A log written elsewhere can hold a patch to the SPINE — the fleet's own
// journal recorded `entity{num}` rows and the import carried them over. The
// spine IS the bundle's identity, so such a patch merges into `entity` rather
// than landing on top of the eid.
Deno.test('a recorded spine patch merges into the identity', () => {
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
