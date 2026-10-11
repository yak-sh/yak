/// <reference lib="deno.ns" />
// The join: declarations out of the vocabulary, runs out of the module.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { loadTools, tier } from './tools.ts'
import { declared } from './vocab.ts'

let doc = {
  $defs: {
    book: { component: true, type: 'object', properties: {} },
    book_shelve: {
      tool: true,
      noun: 'book',
      verb: 'shelve',
      description: 'Put a book on a shelf.',
      input: { title: { type: 'string' } },
      required: ['title'],
    },
  },
}

test('a declaration wears the run the module gives it', () => {
  let [t] = loadTools(doc, {
    book_shelve: (args) => ({ bundles: [{ book: args }] }),
  })
  assertEquals(t.name, 'book_shelve')
  assertEquals(t.noun, 'book')
  assertEquals(t.description, 'Put a book on a shelf.')
  assertEquals(t.inputSchema?.required, ['title'])
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
