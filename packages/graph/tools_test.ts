/// <reference lib="deno.ns" />
// The join: declarations out of the vocabulary, runs out of the module.

import { assertEquals, assertThrows } from '@std/assert'
import { loadTools } from './tools.ts'

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

Deno.test('a declaration wears the run the module gives it', () => {
  let [t] = loadTools(doc, {
    book_shelve: (args) => ({ change: [{ book: args }] }),
  })
  assertEquals(t.name, 'book_shelve')
  assertEquals(t.noun, 'book')
  assertEquals(t.description, 'Put a book on a shelf.')
  assertEquals(t.inputSchema?.required, ['title'])
  // The entry's name is the tool's; a module that spells its run by the two
  // words instead is the same tool.
  let named = { $defs: { shelve: { ...doc.$defs.book_shelve } } }
  assertEquals(loadTools(named, { book_shelve: () => ({}) })[0].name, 'shelve')
})

Deno.test('a declaration nobody implements is a load error', () => {
  assertThrows(
    () => loadTools(doc, {}),
    Error,
    "tool 'book_shelve' is declared and not implemented",
  )
})
