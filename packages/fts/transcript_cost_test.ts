import '../sqlite/sqlitepath.ts'
import { equal, ok, test } from '@yaks/testing'
import { stepping } from '@yaks/sqlite/testing'
import { storage } from '../sqlite/mod.ts'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { adopt, indexed, search } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    session: { component: true, properties: {} },
    entry: {
      component: true,
      search: ['content.body'],
      properties: { session: { type: 'string', ref: 'session', index: true } },
    },
    content: {
      component: true,
      properties: { body: { type: 'string', contains: true } },
    },
    created: {
      component: true,
      properties: { at: { type: 'number', index: true } },
    },
  },
})
let fields = indexed(vocab)
let entry = (eid: string, session: string, body: string, at = 2): Bundle => ({
  entity: { eid },
  entry: { session },
  content: { body },
  created: { at },
})

let transcript = (history: number) => {
  let { driver, steps } = stepping()
  // The shared file uses the SQL sort for ranks.
  let db = { ...driver, file: true }
  let store = storage(db, vocab)
  store.install()
  let g = graph({ storage: store, vocab })
  g.apply([
    ...['target', 'elsewhere'].map((eid) => ({ entity: { eid }, session: {} })),
    entry('best', 'target', 'shared phrase dragon dragon dragon'),
    ...Array.from(
      { length: history },
      (_, i) => entry(`unrelated-${i}`, 'elsewhere', 'shared phrase dragon'),
    ),
    entry('next', 'target', 'a shared phrase hides a dragon'),
    entry('old', 'target', 'shared phrase dragon', 1),
    entry('no-word', 'target', 'shared phrase'),
    entry('no-phrase', 'target', 'phrase a dragon shared'),
  ])
  adopt(db, fields)
  return (limit: number) => {
    let before = steps()
    let q = parse(
      `.entry.session=target&.content.body~="shared phrase" dragon&.created.at>1&?entry&?created&.limit=${limit}`,
    )
    let rows = db.query(compile(q, vocab, { extend: [search(fields, db)] }))
    return { eids: rows.map((r) => r.eid), cost: steps() - before }
  }
}

let short = transcript(20), long = transcript(1020)

test('a ranked transcript page checks its own session even for a common word', () => {
  for (let limit of [1, 14]) {
    let small = short(limit), large = long(limit)
    let expected = ['best', 'next'].slice(0, limit)
    equal(small.eids, expected)
    equal(large.eids, expected)
    // FTS may walk compact postings, but each foreign hit must skip the
    // session, timestamp and literal-substring reads, even on a short page.
    ok(
      large.cost - small.cost < 15_000,
      `${small.cost} then ${large.cost} steps`,
    )
  }
})

// A word over every index, kept to transcript entries: the doc index's page
// first asks whether any entry carries a doc at all. That asks from the
// smaller side, the few docs, not by walking every entry.
let words = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    session: { component: true, properties: {} },
    entry: {
      component: true,
      search: ['content.body'],
      properties: { session: { type: 'string', ref: 'session', index: true } },
    },
    content: {
      component: true,
      properties: { body: { type: 'string', contains: true } },
    },
    created: {
      component: true,
      properties: { at: { type: 'number', index: true } },
    },
    doc: {
      component: true,
      properties: { title: { type: 'string', search: true } },
    },
  },
})
let kept = (history: number) => {
  let { driver, steps } = stepping()
  let db = { ...driver, file: true }
  let store = storage(db, words)
  store.install()
  graph({ storage: store, vocab: words }).apply([
    { entity: { eid: 'target' }, session: {} },
    ...Array.from(
      { length: history },
      (_, i) => entry(`said-${i}`, 'target', `line ${i}`),
    ),
    entry('found', 'target', 'a dragon'),
    { entity: { eid: 'titled' }, doc: { title: 'dragon notes' } },
  ])
  let all = indexed(words)
  adopt(db, all)
  let before = steps()
  let rows = db.query(
    compile(parse('dragon .entry ?entry .limit=5'), words, {
      extend: [search(all, db)],
    }),
  )
  return { eids: rows.map((r) => r.eid), cost: steps() - before }
}

test('a word kept to entries never walks them to ask whether any is titled', () => {
  let small = kept(20), large = kept(4020)
  equal([small.eids, large.eids], [['found'], ['found']])
  ok(large.cost - small.cost < 20_000, `${small.cost} then ${large.cost} steps`)
})
