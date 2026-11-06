import { test } from '@yaks/testing'
import type { Comp } from '@yaks/graph'
import { assertEquals } from '@std/assert'
import { hashEmbedder, type Hit, type meaning, scored } from '@yaks/embedding'
import { line, memoryDoc, saved } from '@yaks/memory'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { ram } from '@yaks/ram'
import { parse } from '@yaks/query'
import { col, render, select, type Statements, table } from '@yaks/sql'
import { ranking } from './embedding-read.ts'

let vocab = loadVocab([docDoc, memoryDoc, {
  $defs: {
    created: {
      component: true,
      properties: { at: { type: 'string', format: 'date-time' } },
    },
  },
}])
let store = ram(vocab)
let rows = [
  ...saved({ eid: 'soft', said: 'keep the pages soft', space: 'kitchen' }),
  ...saved({ eid: 'grams', said: 'use grams, never cups', space: 'kitchen' }),
  ...saved({ eid: 'away', said: 'pages pages pages', space: 'elsewhere' }),
]
store.tx((tx) => tx.patch(rows))
let words = hashEmbedder(64)
let vectors = await Promise.all(rows.map(async (row, owner) => ({
  owner,
  eid: row.entity.eid,
  vector: await words.embed(String((row.doc as Comp).body)),
})))
let phrase = 'pages look friendly'
let query = await words.embed(phrase)
let within = line({ space: 'kitchen', limit: 8 })
let scopeQuery = parse(within)
let visible = new Set(store.read(scopeQuery).map((row) => row.entity.eid))
let admitted = vectors.filter((row) => visible.has(row.eid))

test("a recall ranks a space's memories by meaning", () => {
  let hits = scored(query, admitted)
  assertEquals(hits.map((hit) => vectors[hit.owner].eid), ['soft', 'grams'])
})

let statements: Statements = {
  query: () => {
    throw new Error('this ranking delegates its SQL capability')
  },
  ownership: 'exclusive',
  revision: () => 0,
  atomic: (body) => body(),
}
let fields = [{ comp: 'doc', prop: 'body' }]
let scope = render(select({ cols: [col('id')], from: table('entity') }))
let screened: string[] = []
let held = {
  statements,
  fields,
  screen: (line: string) => {
    screened.push(line)
    return scope
  },
}
let hits: Hit[] = [
  { entity: 'soft', similarity: 0.5, excerpt: 'keep the pages soft' },
  { entity: 'grams', similarity: 0, excerpt: 'use grams, never cups' },
]
let search: typeof meaning = (sql, on, model, said, opts) => {
  assertEquals([sql, on, model, said], [statements, fields, words, phrase])
  assertEquals(opts?.limit, 2)
  assertEquals(opts?.screen?.(), scope)
  return Promise.resolve(hits)
}

test('a store delegates its current model, words, limit and space scope to semantic search', async () => {
  assertEquals(
    await ranking(() => words, held, search)(phrase, { limit: 2, within }),
    hits,
  )
  assertEquals(screened, [within])
})

test('a store with no model bound ranks no memories', async () => {
  assertEquals(await ranking(() => null, held, search)(phrase, { within }), [])
})
