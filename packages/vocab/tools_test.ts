import { assertEquals, assertThrows } from '@std/assert'
import {
  toolDefinition,
  validateToolInput,
  validateToolOutput,
} from './tools.ts'

const draft7 = 'http://json-schema.org/draft-07/schema#'
Deno.test('tool schemas preserve draft-07 tuple semantics beside 2020 schemas', () => {
  const inputSchema = {
    $schema: draft7,
    type: 'object',
    properties: {
      pair: {
        type: 'array',
        items: [{ type: 'string' }, { type: 'integer' }],
        additionalItems: false,
      },
    },
    required: ['pair'],
  }
  assertEquals(validateToolInput({ inputSchema }, { pair: ['x', 1] }), {
    pair: ['x', 1],
  })
  assertThrows(() => validateToolInput({ inputSchema }, { pair: [1, 'x'] }))
  toolDefinition({
    noun: 'example',
    verb: 'run',
    description: 'Example',
    inputSchema,
  })
  const outputSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      pair: { type: 'array', prefixItems: [{ type: 'string' }], items: false },
    },
  }
  validateToolOutput({ outputSchema }, { pair: ['x'] })
  assertThrows(() => validateToolOutput({ outputSchema }, { pair: ['x', 'y'] }))
})
Deno.test('draft-07 outputs validate without defaults and unsupported dialects fail clearly', () => {
  const outputSchema = {
    $schema: draft7,
    type: 'object',
    properties: { text: { type: 'string', default: 'no' } },
    required: ['text'],
  }
  validateToolOutput({ outputSchema }, { text: 'about' })
  const value = {}
  assertThrows(() => validateToolOutput({ outputSchema }, value))
  assertEquals(value, {})
  assertThrows(
    () =>
      validateToolInput({
        inputSchema: { $schema: 'https://example.test/unknown' },
      }, {}),
    Error,
    'Unsupported tool JSON Schema dialect',
  )
  assertThrows(() =>
    validateToolInput({
      inputSchema: { $ref: 'https://example.test/external' },
    }, {})
  )
})

Deno.test('2019 schema semantics and independent identical IDs use selected dialect', () => {
  const inputSchema = {
    $schema: 'https://json-schema.org/draft/2019-09/schema',
    type: 'object',
    dependentRequired: { a: ['b'] },
    properties: { a: { type: 'string' }, b: { type: 'string' } },
  }
  assertThrows(() => validateToolInput({ inputSchema }, { a: 'x' }))
  assertEquals(validateToolInput({ inputSchema }, { a: 'x', b: 'y' }), {
    a: 'x',
    b: 'y',
  })
  for (const type of ['string', 'integer']) {
    const schema = {
      $schema: draft7,
      $id: 'https://example.test/same',
      type: 'object',
      properties: { x: { type } },
    }
    validateToolOutput({ outputSchema: schema }, {
      x: type === 'string' ? 'x' : 1,
    })
  }
})

Deno.test('a vocabulary carries tool declarations beside its components', async () => {
  let { toolsIn } = await import('./tools.ts')
  let doc = {
    $defs: {
      session: { component: true, type: 'object', properties: {} },
      helper: { type: 'string' },
      session_list: {
        tool: true,
        noun: 'session',
        verb: 'list',
        description: 'List sessions.',
        input: { scope: { type: 'string' }, limit: { type: 'integer' } },
        required: ['scope'],
        options: { positional: ['scope'] },
        readOnly: true,
      },
    },
  }
  let [t] = toolsIn(doc)
  assertEquals(toolsIn(doc).length, 1) // the component and the subschema pass by
  assertEquals(t.name, 'session_list')
  assertEquals(t.readOnly, true)
  // `input` is one schema per argument; what travels is the object schema
  // every door downstream already reads.
  assertEquals(t.inputSchema, {
    type: 'object',
    additionalProperties: false,
    properties: { scope: { type: 'string' }, limit: { type: 'integer' } },
    required: ['scope'],
  })
  assertEquals(validateToolInput(t, { scope: 'root' }), { scope: 'root' })
  assertThrows(
    () => validateToolInput(t, { scope: 'root', limit: 'lots' }),
    Error,
    'Invalid tool arguments',
  )
})
