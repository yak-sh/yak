/// <reference lib="deno.ns" />
// The join: declarations out of the vocabulary, runs out of the module.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { loadTools, tier } from './tools.ts'
import { declared } from './vocab.ts'
import { Refused } from './errors.ts'
import type { Bundle } from './bundle.ts'
import type { Graph } from './graph.ts'
import { toolRow } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import { validateToolInput } from '@yaks/vocab/tools'

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
  assertThrows(
    () => read(['bok', 'book', 'shelv']),
    Refused,
    "no component 'bok', 'shelv' — call graph_schema with no arguments",
  )
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
