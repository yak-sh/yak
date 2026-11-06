import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { matcher } from '@yaks/match'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { scope, unasked } from './query-line.ts'
import { asking, screened } from './listing.ts'

// A line naming only its app reads nothing, and an empty answer reads as an
// empty app; the refusal hands over a line that reads what the app keeps.
let choresVocab = loadVocab({
  $defs: {
    chore: { component: true },
    doc: { component: true, properties: { title: { type: 'string' } } },
  },
})
let chores = graph({ vocab: choresVocab, storage: ram(choresVocab) })
chores.apply([{
  entity: { eid: 'c' },
  chore: {},
  doc: { title: 'sweep' },
}])

let appOnly = () =>
  unasked('chores', 'chores', {
    chore: {},
    sweep: { tool: {} },
    doc: { extends: 'chore' },
  })
let suggested = (said: string) => said.match(/'([^']+&\.in=chores)'/)?.[1]
let suggestion = scope(suggested(appOnly())!)
let suggestedRows = await chores.read('*')
let suggestedRead = matcher(suggestion.line, choresVocab)

test('a read naming only an app says what to read in it', () => {
  assertEquals(suggested(appOnly()), '.chore&?doc&.in=chores')
})

test('the suggested read names the app it was asked about', () => {
  assertEquals(suggestion, { said: 'chores', line: '.chore&?doc' })
})

test('the suggested read finds the rows the app keeps', () => {
  assertEquals(
    suggestedRead(suggestedRows).map((b) => (b.doc as { title: string }).title),
    ['sweep'],
  )
})

// A line naming no component reads what the app keeps, and the store's own
// rows (its archetypes, its effects queue, who may reach it) stay out of the
// answer unless the line names one.
let kept = loadVocab([archetypeDoc, {
  $defs: {
    item: { component: true, properties: { name: { type: 'string' } } },
  },
}])
let store = graph({
  vocab: kept,
  storage: ram(kept),
  plugins: [archetypes()],
})
store.apply([{ entity: { eid: 'milk' }, item: { name: 'milk' } }])

let words = screened((w) => !!kept.comp(w), false)
let rows = await store.read('*')
let queries = new Map(
  ['.limit=5', '*', '.limit=50', '.archetype'].map((
    q,
  ) => [q, matcher(asking(q, words), kept)]),
)
let keptIds = (q: string) => queries.get(q)!(rows).map((b) => b.entity.eid)

test('a read naming no component answers only what the app keeps', () => {
  assertEquals(keptIds('.limit=5'), ['milk'])
})

for (let q of ['*', '.limit=50']) {
  test(`a read of ${q} answers only what the app keeps`, () => {
    assertEquals(keptIds(q), ['milk'])
  })
}

test('a read naming archetypes includes the store archetypes', () => {
  assertEquals(keptIds('.archetype').length > 0, true)
})
