// The meta-schema, used the way a document author uses it: ajv over
// metaSchema, one $defs entry at a time. What is checked here is the
// discriminator — an entry is a component, a tool, or neither, and the shape
// it must have follows from which it said.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { PropSchema } from './mod.ts'
import { meta } from './testing.ts'

let { ajv, check } = meta()
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

test('a marked component is a component, an unmarked entry is nobody’s', () => {
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

test('a tool declaration is checked as a tool', () => {
  assertEquals(ok(TOOL), [])
  assertEquals(
    ok({ ...TOOL, input: { scope: { type: 'string', short: 's' } } }),
    [],
  )
  assert(ok({ ...TOOL, options: {} }).length)
  assert(
    ok({ ...TOOL, input: { scope: { type: 'string', short: 'many' } } }).length,
  )
  assertEquals(ok({ ...TOOL, readOnly: true, positional: ['scope...'] }), [])
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

test('a property declares its type, and a JSON one may declare its shape', () => {
  let prop = (s: PropSchema) =>
    ok({ component: true, type: 'object', properties: { c: s } })
  assertEquals(prop({ type: 'string', enum: ['a'] }), [])
  assertEquals(prop({ type: 'string', format: 'json' }), [])
  assertEquals(
    prop({ type: 'object', properties: { a: { type: 'number' } } }),
    [],
  )
  assertEquals(prop({ type: 'array', items: { type: 'string' } }), [])
  assertEquals(prop({ type: ['string', 'object', 'null'] }), [])
  assert(prop({ enum: ['a'] }).length)
  assert(prop({ type: 'null' }).length)
})

test('the meta-schema admits save only for permanent peer-relayed values', () => {
  let peers = {
    component: true,
    type: 'object',
    sync: 'peers',
    save: '!position | .updated.at<="30s ago"',
  }
  assertEquals(ok(peers), [])
  assertEquals(ok({ ...peers, durable: 'forever', pace: '100ms' }), [])
  assertEquals(ok({ ...peers, save: '.position.x>5' }), [])
  for (
    let save of [
      '',
      ' ',
      '\t',
      '30s',
      '-1s',
      '+5s',
      ' 30s ',
      '9'.repeat(400) + 's',
    ]
  ) {
    assert(ok({ ...peers, save }).length)
  }
  for (let sync of [undefined, 'none', 'server']) {
    assert(ok({ ...peers, sync }).length)
  }
  for (let durable of ['connection', '5s']) {
    assert(ok({ ...peers, durable }).length)
  }
})

test('expire admits a query for a stored component, never a duration or blank', () => {
  assertEquals(ok({ component: true, expire: '.thing.at<="7d ago"' }), [])
  for (let expire of ['', ' ', '7d', 7, true]) {
    assert(ok({ component: true, expire } as PropSchema).length)
  }
})
