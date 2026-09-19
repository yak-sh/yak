// Document validation: the storable profile, reserved names, and the
// additive-forever evolution rule. Each refusal names the fix.

import { assert, assertEquals } from '@std/assert'
import { grow, loadVocab, reserved, storable } from './mod.ts'
import type { PropSchema, VocabDoc } from './mod.ts'
import slice from './fleet/slice.schema.json' with { type: 'json' }

let doc = (defs: VocabDoc['$defs']): VocabDoc => ({ $defs: defs })

Deno.test('the slice is storable', () => {
  assertEquals(storable(slice), [])
})

Deno.test('JSON text is storable and nested JSON is refused', () => {
  let schema = (type: string) =>
    doc({
      config: {
        type: 'object',
        properties: { value: { type, format: 'json' } },
      },
    })
  assertEquals(storable(schema('string')), [])
  for (let type of ['object', 'array']) {
    assertEquals(storable(schema(type)), [
      `config.value is ${type} — a column is a scalar`,
    ])
  }
})

Deno.test('storable refuses what a table cannot lower', () => {
  let errs = storable(doc({
    'Bad Name': { type: 'object' },
    recipe: {
      type: 'object',
      properties: {
        steps: { type: 'array' },
        author: { type: 'object' },
        nested: { properties: { deep: { type: 'string' } } },
        linked: { $ref: '#/$defs/recipe' },
        eid: { type: 'string' },
        aim: { type: 'string', ref: 'entity' },
        dead: { type: 'string', ref: 'entity', death: 'explode' },
      },
    },
  }))
  let said = errs.join('\n')
  assert(said.includes('"Bad Name" is not a component name'))
  assert(said.includes('recipe.steps is array'))
  assert(said.includes('recipe.author is object'))
  assert(said.includes('recipe.nested is nested'))
  assert(said.includes('recipe.linked uses $ref'))
  assert(said.includes('recipe."eid" is not a column name'))
  assert(said.includes('recipe.aim is a reference without a death word'))
  assert(said.includes('recipe.dead is a reference without a death word'))
})

Deno.test('storable refuses an index over a column that is not there', () => {
  let errs = storable(doc({
    recipe: {
      type: 'object',
      unique: [['serves', 'oven']],
      index: [['serves']],
      properties: { serves: { type: 'number' } },
    },
  }))
  assertEquals(errs, ['recipe indexes oven, which is no column of recipe'])
})

Deno.test('storable refuses a mark a client could sign', () => {
  let mark = (stamped: boolean) => ({
    baked: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped },
        via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  })
  assertEquals(storable(doc(mark(true))), [])
  assert(
    storable(doc(mark(false)))[0].startsWith('baked.by is wire-writable'),
  )
  // Two of the three is an ordinary vocabulary, and says nothing about marks.
  assertEquals(
    storable(doc({
      sent: {
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time' },
          via: { type: 'string' },
        },
      },
    })),
    [],
  )
})

Deno.test('storable refuses an identity nothing could derive', () => {
  let errs = storable(doc({
    page: {
      type: 'object',
      identity: ['slug'],
      properties: { title: { type: 'string' } },
    },
    release: {
      type: 'object',
      properties: {
        version: { type: 'string', identity: true, stamped: true },
        rank: { type: 'number', identity: true, computed: true },
      },
    },
  }))
  assertEquals(errs, [
    'page is identified by slug, which is no column of it',
    'release.version is server-owned — an identity is derived from what the ' +
    'writer states',
    'release.rank is computed — an identity is derived from what the writer ' +
    'states',
  ])
})

Deno.test('storable refuses search on anything but stored prose', () => {
  let errs = storable(doc({
    recipe: {
      type: 'object',
      properties: {
        note: { type: 'string', search: true },
        serves: { type: 'number', search: true },
        cook: { type: 'string', ref: 'entity', death: 'detach', search: true },
        course: { enum: ['starter', 'main'], search: true },
        made: { type: 'string', format: 'date-time', search: true },
        rank: { type: 'number', computed: true, search: true },
      },
    },
  }))
  assertEquals(errs, [
    'recipe.serves is searched but holds no prose — "search": true is for a stored text column',
    'recipe.cook is searched but holds no prose — "search": true is for a stored text column',
    'recipe.course is searched but holds no prose — "search": true is for a stored text column',
    'recipe.made is searched but holds no prose — "search": true is for a stored text column',
    'recipe.rank is searched but holds no prose — "search": true is for a stored text column',
  ])
})

Deno.test('reserved names refuse against a base vocabulary', () => {
  let base = loadVocab(slice)
  let app = doc({
    doc: { type: 'object' },
    recipe: { type: 'object', properties: { serves: { type: 'number' } } },
  })
  assertEquals(reserved(app, base.all), [
    "'doc' is a word the platform already owns — pick another name",
  ])
  assertEquals(reserved(doc({ recipe: { type: 'object' } }), base.all), [])
})

Deno.test('evolution is additive forever', () => {
  let was = loadVocab(doc({
    recipe: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        serves: { type: 'number' },
        state: { enum: ['draft'] },
      },
    },
  }))
  // adding a column and widening an enum are additive
  let grown = loadVocab(doc({
    recipe: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        serves: { type: 'number' },
        state: { enum: ['draft', 'published'] },
        mins: { type: 'number' },
      },
    },
  }))
  assertEquals(grow(was, grown), { added: ['recipe.mins'], errors: [] })
  // retyping refuses
  let retyped = loadVocab(doc({
    recipe: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        serves: { type: 'string' },
        state: { enum: ['draft'] },
      },
    },
  }))
  assert(grow(was, retyped).errors[0].includes('recipe.serves was'))
  // dropping refuses — the rows are still there
  let dropped = loadVocab(doc({
    recipe: { type: 'object', properties: { title: { type: 'string' } } },
  }))
  let errs = grow(was, dropped).errors.join('\n')
  assert(errs.includes('recipe.serves was dropped'))
  assert(errs.includes('recipe.state was dropped'))
})

Deno.test('text cannot become JSON after rows were written', () => {
  let vocab = (format?: string) =>
    loadVocab(doc({
      config: {
        type: 'object',
        properties: { value: { type: 'string', format } },
      },
    }))
  assertEquals(grow(vocab(), vocab('json')), {
    added: [],
    errors: [
      'config.value was scalar:text:, now scalar:json: — a column keeps the type its rows were written under',
    ],
  })
  assertEquals(grow(vocab('json'), vocab('json')), { added: [], errors: [] })
})

Deno.test('storable refuses a required or present column that is not there', () => {
  let errs = storable(doc({
    output: {
      type: 'object',
      required: ['key', 'rank'],
      unique: [{ cols: ['key'], present: ['ghost'] }],
      properties: {
        key: { type: 'string' },
        rank: { type: 'number', computed: true },
      },
    },
  }))
  assertEquals(errs, [
    'output indexes ghost, which is no column of output',
    'output.rank is computed — it cannot be required',
  ])
})

Deno.test('storable admits a literal or clock default and refuses the rest', () => {
  let one = (props: Record<string, PropSchema>) =>
    storable(doc({ row: { type: 'object', properties: props } }))
  assertEquals(one({ a: { type: 'string', default: 'x' } }), [])
  assertEquals(one({ a: { type: 'boolean', default: true } }), [])
  assertEquals(
    one({
      at: { type: 'string', format: 'date-time', default: { now: true } },
    }),
    [],
  )
  assertEquals(one({ a: { type: 'string', default: { now: true } } }), [
    'row.a defaults to now but is no date-time column',
  ])
  assertEquals(one({ a: { type: 'string', default: ['x'] } }), [
    'row.a has a default no column can hold (a literal, or {"now": true})',
  ])
})

Deno.test('a relay owns nothing, so it cannot keep a value forever', () => {
  let one = (comp: PropSchema) => storable(doc({ presence: comp }))
  assertEquals(
    one({ type: 'object', sync: 'peers', durable: 'disconnect' }),
    [],
  )
  assertEquals(one({ type: 'object', sync: 'peers', durable: '5s' }), [])
  assertEquals(one({ type: 'object', sync: 'none', durable: '250ms' }), [])
  assertEquals(one({ type: 'object', sync: 'peers', durable: 'forever' }), [
    'presence syncs to peers and is durable forever — a relay hands a value on without owning it, so it has nowhere to keep one; say "disconnect" or a duration, or sync to the server',
  ])
  assertEquals(one({ type: 'object', sync: 'everyone' }), [
    'presence syncs "everyone" — a component syncs to none, server, peers',
  ])
  assertEquals(one({ type: 'object', sync: 'peers', durable: 'a while' }), [
    'presence is durable "a while" — say "forever", "disconnect", or a duration such as "5s" or "2m"',
  ])
})
