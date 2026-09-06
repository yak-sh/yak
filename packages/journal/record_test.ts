/// <reference lib="deno.ns" />
// What the record holds: a create, a patch and a death, in the order they
// happened, each with the actor that wrote it — and nothing about the batches
// that were refused.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { graph, isPromise } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { history } from './read.ts'
import { logger, wiki, wikiGraph } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out as T
}

let ada = { by: 'ada' }
let bob = { by: 'bob', via: 'cli' }

let fixture = () => {
  let g = wikiGraph()
  return {
    g,
    apply: (change: Bundle[]) => sync(g.apply(change)),
    past: (eid: string) => sync(history(g)(eid)),
  }
}

// A batch, flattened to one line per delta: `1 ada page.title Kickoff→Retro`.
let lines = (g: ReturnType<typeof fixture>, eid: string) =>
  g.past(eid).flatMap((b) =>
    b.deltas.map((d) =>
      `${b.seq} ${b.by} ${d.comp}${d.column ? '.' + d.column : ''} ` +
      `${JSON.stringify(d.before)}→${JSON.stringify(d.after)}`
    )
  )

Deno.test('history lists a create, two patches and a death, in order', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' }, $actor: ada }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' }, $actor: bob }])
  f.apply([{ entity: { eid: 'p1' }, page: { text: 'notes' }, $actor: ada }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true, $actor: bob }])
  assertEquals(lines(f, 'p1'), [
    '1 ada page null→{}',
    '1 ada page.title null→"Kickoff"',
    '2 bob page.title "Kickoff"→"Retro"',
    '3 ada page.text null→"notes"',
    '4 bob page {"title":"Retro","text":"notes"}→null',
    '4 bob tombstone null→{}',
  ])
})

Deno.test('a batch row carries the actor, the instrument and the moment', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' }, $actor: bob }])
  let [batch] = f.past('p1')
  assertEquals(batch.by, 'bob')
  assertEquals(batch.via, 'cli')
  assertEquals(batch.at, '2026-01-01T00:00:00.000Z')
  assertEquals(batch.seq, 1)
})

Deno.test('the provenance stamps are not recorded twice', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' }, $actor: ada }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' }, $actor: ada }])
  let stamps = f.past('p1').flatMap((b) => b.deltas.map((d) => d.comp))
    .filter((c) => c == 'created' || c == 'updated')
  assertEquals(stamps, [], 'created/updated live on the batch row')
})

Deno.test('a cascade casualty is recorded, whole, under its own entity', () => {
  let f = fixture()
  f.apply([
    { entity: { eid: 'p1' }, page: { title: 'One' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ])
  f.apply([{ entity: { eid: 'p1' }, $delete: true, $actor: ada }])
  assertEquals(lines(f, 'n1').slice(-2), [
    '2 ada note {"text":"aside","page":"p1"}→null',
    '2 ada tombstone null→{}',
  ])
})

Deno.test('a component dropped is recorded whole, and a column cleared is not', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One', text: 'body' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { text: null } }])
  f.apply([{ entity: { eid: 'p1' }, page: null }])
  assertEquals(lines(f, 'p1').slice(-2), [
    '2 null page.text "body"→null',
    '3 null page {"title":"One"}→null',
  ])
})

Deno.test('a refused batch leaves no record', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  try {
    f.apply([{
      entity: { eid: 'p1' },
      page: { title: 'Two' },
      $was: { page: { title: null } },
    }])
  } catch { /* the guard refused it, which is the point */ }
  assertEquals(f.past('p1').length, 1)
})

Deno.test('a batch that moved nothing writes no row', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  f.apply([{ entity: { eid: 'p1' } }])
  assertEquals(f.past('p1').length, 1)
})

Deno.test('the reading it takes never reaches the caller, or an effect', () => {
  let fired: string[] = []
  let fx = effects(wiki)
  let g = graph({
    storage: ram(wiki),
    vocab: wiki,
    plugins: [logger(wiki), fx],
  })
  fx.created('page', (e) => fired.push(`created ${e.entity.eid}`))
  fx.changed('page', 'title', (e) => fired.push(`retitled ${e.entity.eid}`))
  let out = sync(g.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }]))
  sync(g.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' } }]))
  assertEquals(fired, ['created p1', 'retitled p1'])
  assertEquals(
    out.flatMap((b) => Object.keys(b).filter((k) => k.startsWith('$'))),
    [],
    'both readings are shed before the batch is answered',
  )
  assertEquals(sync(history(g)('p1')).map((b) => b.seq), [1, 2])
})

Deno.test('a second journal counts on from what the log already holds', () => {
  let store = ram(wiki)
  let one = graph({ storage: store, vocab: wiki, plugins: [logger(wiki)] })
  let two = graph({ storage: store, vocab: wiki, plugins: [logger(wiki)] })
  sync(one.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }]))
  sync(two.apply([{ entity: { eid: 'p2' }, page: { title: 'Two' } }]))
  assertEquals(sync(history(one)('p1'))[0].seq, 1)
  assertEquals(sync(history(two)('p2'))[0].seq, 2)
})
