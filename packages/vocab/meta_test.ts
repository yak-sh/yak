// The meta-schema, used the way a document author uses it: ajv over
// metaSchema, one $defs entry at a time. What is checked here is the
// discriminator — an entry is a component, a tool, or neither, and the shape
// it must have follows from which it said.

import { assert, assertEquals } from '@std/assert'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { metaSchema } from './mod.ts'
import type { PropSchema } from './mod.ts'

let ajv = new Ajv2020({ strict: false, allErrors: true })
let check = ajv.compile(metaSchema)
let ok = (entry: PropSchema) => {
  let valid = check({ $defs: { thing: entry } })
  return valid ? [] : ajv.errorsText(check.errors).split(', ')
}

let TOOL = {
  tool: true,
  noun: 'session',
  verb: 'list',
  description: 'List sessions.',
  input: { scope: { type: 'string', enum: ['open', 'done'] } },
}

Deno.test('a marked component is a component, an unmarked entry is nobody’s', () => {
  assertEquals(
    ok({
      component: true,
      type: 'object',
      properties: { n: { type: 'number' } },
    }),
    [],
  )
  // Unmarked: an ordinary subschema, which this meta-model says nothing about
  // — including things a component may not do, like nest.
  assertEquals(
    ok({ type: 'object', properties: { n: { type: 'object' } } }),
    [],
  )
  // Marked, and doing something a component may not: refused as a component.
  assert(ok({ component: true, type: 'array' }).length)
  assert(ok({ component: true, spelled: 'wrong' }).length)
})

Deno.test('a tool declaration is checked as a tool', () => {
  assertEquals(ok(TOOL), [])
  assertEquals(ok({ ...TOOL, readOnly: true, options: { rest: 'words' } }), [])
  // A noun and a verb are two words a line says in either order; either one
  // alone is the whole word, and the entry's own name is the tool's.
  assertEquals(ok({ ...TOOL, verb: undefined }), [])
  assertEquals(ok({ ...TOOL, noun: undefined }), [])
  assertEquals(ok({ ...TOOL, noun: undefined, verb: undefined }), [])
  // Whichever it says is one lowercase word.
  assert(ok({ ...TOOL, noun: 'Session List' }).length)
  assert(ok({ ...TOOL, properties: { n: { type: 'number' } } }).length)
  // And an entry cannot be both: one $defs entry is one thing.
  assert(ok({ ...TOOL, component: true }).length)
})
