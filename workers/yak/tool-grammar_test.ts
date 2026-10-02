import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { appTools, readTools } from './tool-grammar.ts'
import { filled, schemaOf } from '@yaks/tools/declared'

let old = {
  description: 'Keep a note',
  input: { title: { type: 'string' }, limit: { type: 'integer' } },
  required: ['title'],
  options: { positional: ['title'], rest: 'title', short: { n: 'limit' } },
  query: '.doc.title=$title&.limit=$limit',
}

test('kept app declarations translate their grammar without changing input requirements', () => {
  let manifest = { $defs: { note: { tool: true, ...old } } }
  let tool = appTools(manifest).note
  assertEquals(tool.positional, ['title...'])
  assertEquals(tool.input.limit, { type: 'integer', short: 'n' })
  assertEquals(schemaOf(tool), {
    type: 'object',
    properties: old.input,
    required: old.required,
  })
  assertEquals(filled(tool, { title: 'The old release', limit: 3 }), {
    query: '.doc.title=The%20old%20release&.limit=3',
  })
  assertThrows(() => filled(tool, {}), Error, 'title')
  assertEquals(manifest.$defs.note.options, old.options)
})

test('stored app commands translate the same grammar when the store wakes', () => {
  let stored = readTools(JSON.stringify({ note: old })).note
  assertEquals(stored.positional, ['title...'])
  assertEquals(stored.required, ['title'])
  assertEquals(stored.input.limit, { type: 'integer', short: 'n' })
  assertEquals('options' in stored, false)
})

test('legacy declarations are checked before their grammar is translated', () => {
  for (
    let options of [{ rest: 'missing' }, { short: { nn: 'limit' } }, {
      forward: 'title',
    }]
  ) {
    assertThrows(
      () => appTools({ $defs: { note: { tool: true, ...old, options } } }),
      Error,
    )
  }
})
