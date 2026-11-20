/// <reference lib="deno.ns" />
// The join: declarations out of the vocabulary, runs out of the module.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { BEST, loadTools, textSearch, tier } from './tools.ts'
import { graph } from './graph.ts'
import { ram } from '@yaks/ram'
import { declared } from './vocab.ts'
import { Refused } from './errors.ts'
import type { Bundle } from './bundle.ts'
import type { Graph } from './graph.ts'
import { toolRow } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import { unnamed } from '@yaks/id'
import { validateToolInput, validateToolOutput } from '@yaks/vocab/tools'

type Answer = { $defs: Record<string, unknown> }

let doc = {
  $defs: {
    book: { component: true, type: 'object', properties: {} },
    book_shelve: {
      tool: true,
      noun: 'book',
      verb: 'shelve',
      description: 'Put a book on a shelf.',
      revision: '2',
      input: { title: { type: 'string' } },
      required: ['title'],
    },
  },
}

test('a declaration wears the run the module gives it', () => {
  let [t] = loadTools(doc, {
    book_shelve: () => [],
  })
  assertEquals(t.name, 'book_shelve')
  assertEquals(t.noun, 'book')
  assertEquals(t.description, 'Put a book on a shelf.')
  assertEquals(t.inputSchema?.required, ['title'])
  assertEquals(toolRow(t).tool, {
    name: 'book_shelve',
    description: 'Put a book on a shelf.',
    revision: '2',
  })
  // The entry's name is the tool's; a module that names its run by the two
  // words instead is the same tool.
  let named = { $defs: { shelve: { ...doc.$defs.book_shelve } } }
  assertEquals(loadTools(named, { book_shelve: () => ({}) })[0].name, 'shelve')
})

test('a tool that said one word is named by that word', () => {
  let one = {
    $defs: {
      history: {
        tool: true,
        noun: 'history',
        description: 'What happened to it.',
        input: { entity: { type: 'string' } },
      },
    },
  }
  let [t] = loadTools(one, { history: () => ({}) })
  assertEquals([t.name, t.noun, t.verb], ['history', 'history', undefined])
})

test('a declaration nobody implements is a load error', () => {
  assertThrows(
    () => loadTools(doc, {}),
    Error,
    "tool 'book_shelve' is declared and not implemented",
  )
})

// However a model sends several names, they are several: an array, the array
// as JSON text (read at the argument boundary), or one string of names.
let shelves = loadVocab({
  $defs: {
    book: { component: true, type: 'object', properties: {} },
    shelf: { component: true, type: 'object', properties: {} },
  },
  kinds: { library: { is: ['shelf', 'book'] } },
})
let schema = tier().find((t) => t.name == 'graph_schema')!
let read = (component: unknown) => {
  let args = validateToolInput(schema, { component })
  let call = { entity: { eid: 'c' }, call: { args } }
  let [said] = schema.run(call, { vocab: shelves } as Graph) as Bundle[]
  return Object.keys((said.output as { value: Answer }).value.$defs)
}
test('graph_schema reads several components however the names are sent', () => {
  for (
    let names of [
      ['book', 'shelf'],
      '["book", "shelf"]',
      'book, shelf',
      'book shelf',
    ]
  ) assertEquals(read(names), ['book', 'shelf'])
  assertEquals(read('book'), ['book'])
  // a word set as one of its arguments is that argument, and any other names
  // the arguments it takes
  assertEquals(read('component=book'), ['book'])
  assertThrows(
    () => read('space=yourname'),
    Refused,
    'graph_schema takes component and kind, not space',
  )
  assertThrows(
    () => read(['bok', 'book', 'shelv']),
    Refused,
    "no component 'bok' (closest: book), 'shelv' (closest: shelf) — call graph_schema",
  )
  assertThrows(
    () => read('shelv'),
    Refused,
    "no component 'shelv' (closest: shelf) — call graph_schema",
  )
  assertThrows(() => read('training_entry'), Refused, '(closest: library')
  // a kind's name, as the kinds index lists it, is the kind
  assertEquals(read('library'), ['shelf', 'book'])
})

// The index is what every agent reads to learn the words, so its answer
// meets the output schema it declares, an `entity` property among them.
test('graph_schema answers what its output schema admits', () => {
  let during = loadVocab({
    $defs: {
      during: {
        component: true,
        type: 'object',
        properties: {
          entity: { type: 'string', ref: 'entity', death: 'keep' },
        },
      },
    },
  })
  let call = { entity: { eid: 'c' }, call: { args: {} } }
  let [said] = schema.run(call, { vocab: during } as Graph) as Bundle[]
  validateToolOutput(schema, (said.output as { value: unknown }).value)
})

test('generic declarations describe the search capability and reported keywords', () => {
  let keyword = { enum: ['warm', 'cool'] }
  let keywords = [{
    uri: 'https://example.org/shade',
    prop: ['shade'],
    doc: { $defs: { shade: keyword } },
  }]
  let tools = declared({ keywords, search: true })
  assertEquals(tools.some((t) => t.name == 'search'), true)
  assertEquals(declared().some((t) => t.name == 'search'), false)
  assertEquals(tools.some((t) => 'run' in t), false)
  assertEquals(
    tools.map((t) => t.name),
    tier({ keywords, search: () => [] }).map((t) => t.name),
  )
  let schema = tools.find((t) => t.name == 'graph_schema')!.outputSchema!
  let defs = schema.$defs as Record<
    string,
    { properties: Record<string, unknown> }
  >
  assertEquals(defs.prop.properties.shade, keyword)
  assertEquals(schema.$schema, undefined)
  let properties = schema.properties as Record<string, object>
  assertEquals('propertyNames' in properties.$defs, false)
})

let query = tier().find((t) => t.name == 'graph_query')!
let asked = async (q: string) =>
  await query.run(
    { entity: { eid: 'c' }, call: { args: { q } } },
    { read: () => [], vocab: loadVocab({ $defs: {} }) } as unknown as Graph,
  )
test('graph_query refuses a line that only asks, with the line it meant', async () => {
  await assertRejects(
    () => asked('?topic ?content .limit=3'),
    Refused,
    '?topic ?content filters nothing: ?topic carries topic on the entities ' +
      'a filter selects, so alone it answers the newest entities of every ' +
      'kind — to select the entities that have topic, write ' +
      '.topic&?content&.limit=3',
  )
  // A filter, a search word or a ranking by likeness beside the asks selects.
  for (let q of ['?doc .topic', '?doc moss', '?doc .near=T-1', '* .limit=2']) {
    assertEquals(await asked(q), [])
  }
})

// A shelf of books one word finds, one more than a search answers unasked.
let titled = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string', search: true } },
    },
  },
})
let shelf = graph({ storage: ram(titled), vocab: titled })
shelf.apply(Array.from({ length: BEST + 1 }, (_, i) => ({
  entity: { eid: `book-${i}` },
  book: { title: `Dragon ${i}` },
})))
let found = (args: Record<string, unknown>) =>
  query.run({ entity: { eid: 'c' }, call: { args } }, shelf) as Promise<
    Bundle[]
  >
let searched = async (args: Record<string, unknown>) =>
  (await found(args)).length

test('a search that asks for no window answers its best twenty', async () => {
  assertEquals(await searched({ q: 'dragon' }), BEST)
})

test("a search's own window says how many it answers", async () => {
  assertEquals(await searched({ q: 'dragon', limit: BEST + 1 }), BEST + 1)
})

test('a search that names no component says each row as its hit', async () => {
  let [row] = await found({ q: 'dragon 7' })
  assertEquals(row.book, { title: 'Dragon 7' })
  assertEquals(row.hit, {
    id: 'book-7',
    kind: 'entity',
    title: 'Dragon 7',
    snippet: '',
    source: 'text',
  })
})

test('the search tool answers each row as its entity and hit alone', async () => {
  let search = tier({ search: textSearch(shelf) })
    .find((t) => t.name == 'search')!
  let rows = await search.run(
    { entity: { eid: 'c' }, call: { args: { words: 'dragon 7' } } },
    shelf,
  ) as Bundle[]
  assertEquals(rows, [{
    entity: { eid: 'book-7' },
    hit: {
      id: 'book-7',
      kind: 'entity',
      title: 'Dragon 7',
      snippet: '',
      source: 'text',
    },
  }])
})

test('fields says what each row carries, as .fields= does', async () => {
  let rows = await found({ q: 'dragon 7', limit: 1, fields: 'entity.eid' })
  assertEquals(rows, [{ entity: { eid: 'book-7' } }])
})

test('a search that names a component answers what it names', async () => {
  let [row] = await found({ q: 'dragon 7 ?book' })
  assertEquals(Object.keys(row).sort(), ['book', 'entity'])
})

// Two books, and an identity a malformed writer left holding nothing.
let kept = ram(titled)
let books = graph({ storage: kept, vocab: titled })
books.apply([
  { entity: { eid: 'b1' }, book: { title: 'Dune' } },
  { entity: { eid: 'b2' }, book: { title: 'Emma' } },
])
kept.tx((tx) => tx.patch([{ entity: { eid: 'empty' } }]))
let show = tier().find((t) => t.name == 'graph_show')!
let shown = (...ids: string[]) =>
  show.run({ entity: { eid: 'c' }, call: { args: { ids } } }, books) as Promise<
    Bundle[]
  >

test('graph_show answers the ids that name something and says which do not', async () => {
  assertEquals((await shown('b1', 'b2')).map((b) => b.entity.eid), ['b1', 'b2'])
  let out = await shown('b1', 'gone', 'empty', 'b2')
  assertEquals(out.map((b) => b.entity.eid), ['b1', 'b2', '$said'])
  assertEquals(out[2].content, {
    body: `${unnamed('gone')}; ${unnamed('empty')}; the other 2 are shown`,
  })
  assertEquals(out[2].output, { source: 'c' })
  await assertRejects(
    () => shown('gone'),
    Refused,
    `${unnamed('gone')}; graph_query by what it holds`,
  )
  let searching = tier({ search: () => [] }).find((t) =>
    t.name == 'graph_show'
  )!
  await assertRejects(
    async () =>
      await searching.run(
        { entity: { eid: 'c' }, call: { args: { id: 'gone' } } },
        books,
      ),
    Refused,
    `${unnamed('gone')}; search finds an entity by its words, and ` +
      'graph_query by what it holds',
  )
})
