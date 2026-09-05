/// <reference lib="deno.ns" />
// Walking a batch backwards: what an undo restores, what it refuses, and the
// fact that an undo is an ordinary write — journaled in its turn, so undoing
// it again is a redo.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { history } from './read.ts'
import { at } from './read.ts'
import { applied, Final, undo } from './undo.ts'
import { wikiGraph } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out as T
}

let fixture = () => {
  let g = wikiGraph()
  return {
    g,
    apply: (change: Bundle[]) => sync(g.apply(change)),
    past: (eid: string) => sync(history(g)(eid)),
    back: (seq: number, by?: string) =>
      sync(undo(g)(seq, by ? { by } : undefined)),
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
  let past = f.past('p1')
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
  assertEquals(applied(sync(at(f.g)(1))!), [
    { entity: { eid: 'p1' }, page: { title: 'Kickoff', text: 'body' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ])
})

Deno.test('applied() rebuilds a death as a death', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertEquals(applied(sync(at(f.g)(2))!), [
    { entity: { eid: 'p1' }, $delete: true },
  ])
})
