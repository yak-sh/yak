// An app's own components, from the manifest to its DDL: what vocab.json may
// say, and what it may not. The round trips that wrote one of these words into
// a graph and read it back went with the fleet server's db.ts (T-37584); the
// same word through app_deploy and the Store object is do_test.ts's.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { GUIDE, parseVocab, vocabOps } from './vocab.ts'

let recipes = { recipe: { title: 'text', serves: 'number' } }

Deno.test('vocab.json: a component per key, a typed column per entry', () => {
  assertEquals(parseVocab('{"recipe":{"title":"text","serves":"number"}}'), {
    recipe: { title: 'text', serves: 'number' },
  })
  // A facet with no columns is a word too.
  assertEquals(parseVocab({ cookbook: {} }), { cookbook: {} })
})

Deno.test('vocab.json: every refusal names the file', () => {
  let why = (source: unknown) =>
    assertThrows(() => parseVocab(source), Error).message
  assertEquals(why('not json').includes('vocab.json is not JSON'), true)
  assertEquals(why([1]).includes('vocab.json is an object'), true)
  // The platform's words are the platform's, in every store — and the WHOLE
  // manifest is checked, so probing for a free name is one deploy, not one
  // per collision (C-32624 item 1).
  assertStringIncludes(
    why({ doc: { x: 'text' } }),
    'vocab.json: doc is a word the platform already says',
  )
  let both = why({ doc: {}, recipe: {}, entry: {} })
  assertStringIncludes(both, 'doc, entry are words the platform already says')
  assertStringIncludes(both, GUIDE)
  assertEquals(why({ Recipe: {} }).includes('is not a component name'), true)
  assertEquals(why({ recipe: { serves: 'int' } }).includes('one of text'), true)
  assertEquals(
    why({ recipe: { entity: 'text' } }).includes('is not a column name'),
    true,
  )
})

Deno.test('vocab.json: the DDL is a create plus one guarded add per column', () => {
  let ops = vocabOps(parseVocab(recipes))
  assertEquals(ops.length, 3)
  assertEquals(ops[0].kind, 'exec')
  assertEquals(ops[0].sql.includes('create table if not exists "recipe"'), true)
  assertEquals(ops[0].sql.includes('"serves" real'), true)
  assertEquals(ops.slice(1).map((o) => o.kind), ['addColumn', 'addColumn'])
})
