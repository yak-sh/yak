/// <reference lib="deno.ns" />
// The same journal over a database. @yaks/ram holds bundles in a Map and
// SQLite holds rows in tables; the log is components either way, so the same
// history, the same undo, the same feed must come back — and, because both
// adapters are synchronous, without an await anywhere.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph, isPromise } from '@yaks/graph'
import { storage } from '../sqlite/mod.ts'
import { mem } from '../sqlite/harness.ts'
import { history, since } from './read.ts'
import { Final, undo } from './undo.ts'
import { logger, wiki } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'the stack went async over an embedded database')
  return out as T
}

let wikiDb = (): Graph => {
  let store = storage(mem(), wiki)
  store.install()
  return graph({ storage: store, vocab: wiki, plugins: [logger(wiki)] })
}

let fixture = () => {
  let g = wikiDb()
  return {
    g,
    apply: (change: Bundle[]) => sync(g.apply(change)),
    past: (eid: string) => sync(history(g)(eid)),
  }
}

Deno.test('a create, two patches and a death, in order, over SQLite', () => {
  let f = fixture()
  f.apply([{
    entity: { eid: 'p1' },
    page: { title: 'Kickoff' },
    $actor: { by: 'ada' },
  }])
  f.apply([{
    entity: { eid: 'p1' },
    page: { title: 'Retro' },
    $actor: { by: 'bob' },
  }])
  f.apply([{ entity: { eid: 'p1' }, page: { text: 'notes' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true, $actor: { by: 'ada' } }])
  assertEquals(
    f.past('p1').flatMap((b) =>
      b.deltas.map((d) =>
        `${b.seq} ${b.by} ${d.comp}${d.column ? '.' + d.column : ''}`
      )
    ),
    [
      '1 ada page',
      '1 ada page.title',
      '2 bob page.title',
      '3 null page.text',
      '4 ada page',
      '4 ada tombstone',
    ],
  )
  assertEquals(f.past('p1')[3].deltas[0].before, {
    title: 'Retro',
    text: 'notes',
  }, 'the component it lost, whole and without its empty columns')
})

Deno.test('undo restores the prior column over SQLite', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  sync(undo(f.g)(2, { by: 'ada' }))
  let now = sync(f.g.read('.kind=page'))[0]
  assertEquals((now.page as Record<string, unknown>).title, 'Kickoff')
  assertEquals(f.past('p1').at(-1)?.by, 'ada')
})

Deno.test('undo of a death is refused over SQLite too', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertThrows(() => sync(undo(f.g)(2)), Final)
})

Deno.test('the feed pages over SQLite without repeating a batch', () => {
  let f = fixture()
  for (let i = 1; i <= 4; i++) {
    f.apply([{ entity: { eid: `p${i}` }, page: { title: `page ${i}` } }])
  }
  let seen: number[] = []
  let cursor = { seq: 0 }
  for (let i = 0; i < 3; i++) {
    let page = sync(since(f.g)(cursor, 2))
    seen.push(...page.batches.map((b) => b.seq))
    cursor = page.cursor
  }
  assertEquals(seen, [1, 2, 3, 4])
})
