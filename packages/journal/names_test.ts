/// <reference lib="deno.ns" />
// The journal records each word by its identity and reads it back by its
// label: a rename keeps its history, and rows recorded by label before
// identities read alike (./names.ts).

import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { whole } from '@yaks/query'
import { col, select, table } from '@yaks/sql'
import { loadVocab, metaDoc, type Vocab, type VocabDoc } from '@yaks/vocab'
import { bounded, mem } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { backed, ddl, journal, type Log, log } from './mod.ts'
import { journalDoc } from './vocab.ts'
import { sync } from './testing.ts'

let PAGE = mint(), TITLE = mint(), TEXT = mint()
let urn = (id: string) => `urn:uuid:${id}`

// `page{title, text}`, under other labels when given, and without its
// identities where `ids` is false: what a journal wrote before identities.
let words = (
  labels = ['page', 'title', 'text'],
  ids = true,
  more: VocabDoc['$defs'] = {},
): Vocab => {
  let [comp, title, text] = labels
  let $id = (id: string) => ids ? { $id: urn(id) } : {}
  return loadVocab([metaDoc, journalDoc, {
    $defs: {
      ...more,
      [comp]: {
        ...$id(PAGE),
        component: true,
        type: 'object',
        properties: {
          [title]: { ...$id(TITLE), type: 'string' },
          [text]: { ...$id(TEXT), type: 'string' },
        },
      },
    },
  }])
}

// One store, and a graph journaling into it in `vocab`'s words.
let store = (v = words(), db = mem()) => {
  let s = storage(db, v, { backed: backed(v) })
  s.install()
  for (let stmt of ddl(v)) db.query(stmt)
  let as = (vocab: Vocab) => {
    let j = log({ rows: (stmt) => db.query(stmt), vocab })
    let g = graph({ storage: s, vocab, plugins: [journal(j, vocab)] })
    return { j, apply: (bundles: Bundle[]) => sync(g.apply(bundles)), g }
  }
  let names = (name: string, t: string) =>
    db.query(select({ cols: [col(name)], from: table(t), order: [col('id')] }))
      .map((r) => String(r[name]))
  let recorded = () => [
    ...names('component', 'journal_change'),
    ...names('field', 'journal_field'),
  ]
  return { as, recorded }
}

// A history, a line per delta: `page.title null→"Kickoff"`.
let lines = (j: Log, eid: string) =>
  j.history(eid).flatMap((b) =>
    b.deltas.map((d) =>
      `${d.comp}${d.prop ? '.' + d.prop : ''} ` +
      `${JSON.stringify(d.before ?? null)}→${JSON.stringify(d.after ?? null)}`
    )
  )

test('a change records its component and properties by identity', () => {
  let s = store()
  let now = s.as(words())
  now.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  now.apply([{ entity: { eid: 'p1' }, page: null }])
  equal(s.recorded(), [PAGE, PAGE, TITLE, TITLE])
  equal(lines(now.j, 'p1'), [
    'page null→{}',
    'page.title null→"Kickoff"',
    'page {"title":"Kickoff"}→null',
  ])
  equal(now.j.held(), { page: 2 })
})

test('a renamed word’s history reads under its new label', () => {
  let s = store()
  s.as(words()).apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  let renamed = s.as(words(['sheet', 'heading', 'body']))
  equal(lines(renamed.j, 'p1'), [
    'sheet null→{}',
    'sheet.heading null→"Kickoff"',
  ])
  equal(renamed.j.wrote('sheet', 'heading').map((w) => w.value), ['Kickoff'])
})

test('rows recorded by label read as the rows recorded by identity do', () => {
  let s = store()
  s.as(words(undefined, false)).apply([
    { entity: { eid: 'p1' }, page: { title: 'Kickoff', text: 'draft' } },
  ])
  let now = s.as(words())
  now.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  now.apply([{ entity: { eid: 'p1' }, page: null }])
  // The removal tombstones each property once, whichever way it was recorded.
  equal(s.recorded(), [
    'page',
    PAGE,
    PAGE,
    'title',
    'text',
    TITLE,
    TITLE,
    TEXT,
  ])
  equal(lines(now.j, 'p1'), [
    'page null→{}',
    'page.title null→"Kickoff"',
    'page.text null→"draft"',
    'page.title "Kickoff"→"Retro"',
    'page {"title":"Retro","text":"draft"}→null',
  ])
  equal(now.j.wrote('page', 'title').map((w) => w.value), ['Kickoff', 'Retro'])
  equal(now.j.held(), { page: 3 })
})

test('_change names its component by label and points at its _comp row', () => {
  let s = store()
  s.as(words(undefined, false)).apply([
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
  ])
  let now = s.as(words())
  now.apply([{ entity: { eid: 'p1' }, page: { text: 'notes' } }])
  sync(now.g.apply([{ entity: { eid: PAGE }, _comp: { name: 'page' } }], {
    trusted: true,
  }))
  let changes = (q: string) =>
    sync(now.g.read(whole(q))).map((b) => {
      let { comp, component, value } = b._change as Comp
      return [comp, component, value]
    })
  let both = [
    [PAGE, 'page', { title: 'Kickoff' }],
    [PAGE, 'page', { text: 'notes' }],
  ]
  equal(changes('._change.target=p1'), both)
  equal(changes(`._change.comp=${PAGE}`), both)
  equal(changes('._change.component=page'), both)
})

test('a scope judges a deleted entity by what either shape last told', () => {
  let s = store()
  s.as(words(undefined, false)).apply([
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
    { entity: { eid: 'p2' }, page: { title: 'Kickoff' } },
  ])
  let now = s.as(words())
  now.apply([{ entity: { eid: 'p2' }, page: { title: 'Retro' } }])
  now.apply(['p1', 'p2'].map((eid) => ({ entity: { eid }, $delete: true })))
  let seen = (entity: string) =>
    sync(
      graph({
        storage: now.g.storage,
        vocab: now.g.vocab,
        plugins: [{ name: 'scope', scope: () => ({ entity }) }],
      }).get(['p1', 'p2']),
    ).map((b) => b.entity.eid)
  equal(seen('.page.title=Kickoff'), ['p1'])
  equal(seen('.page.title=Retro'), ['p2'])
})

test('a history reads in one short statement however many words the vocabulary has', () => {
  // Forty components of fifty properties, each with its identity: their names
  // alone run past the 100,000 bytes workerd allows a statement.
  let more = Object.fromEntries(
    Array.from({ length: 40 }, (_, c) => [`c${c}`, {
      $id: urn(mint()),
      component: true,
      type: 'object',
      properties: Object.fromEntries(
        Array.from(
          { length: 50 },
          (_, p) => [`p${p}`, { $id: urn(mint()), type: 'string' }],
        ),
      ),
    }]),
  )
  let v = words(undefined, true, more)
  let s = store(v, bounded({ sqlLength: 100_000 }))
  let now = s.as(v)
  now.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  now.apply([{ entity: { eid: 'p1' }, c39: { p49: 'last' } }])
  let read = (q: string) =>
    sync(now.g.read(whole(q))).map((b) => {
      let { component, value } = b._change as Comp
      return [component, value]
    })
  equal(read('._change.target=p1'), [
    ['page', { title: 'Kickoff' }],
    ['c39', { p49: 'last' }],
  ])
  equal(read('._change.component=c39'), [['c39', { p49: 'last' }]])
})
