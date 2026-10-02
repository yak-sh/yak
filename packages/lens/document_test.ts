import { equal, ok, test, throws } from '@yaks/testing'
import { document, type Json, type Op } from './document.ts'
import tools from './tools.fixture.json' with { type: 'json' }

let freeze = <T>(value: T): T => {
  if (value && typeof value == 'object') {
    for (let child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
let roundtrip = (ops: Op[], before: Json, after: Json) => {
  let lens = document(ops)
  let old = freeze(structuredClone(before)),
    current = freeze(structuredClone(after))
  equal(lens.put(old), after)
  equal(lens.get(current), before)
  equal(old, before)
  equal(current, after)
}

test('JSON renames are reversible at any depth and preserve null and omitted data', () => {
  roundtrip(
    [{ rename: { from: 'settings.title', to: 'settings.name' } }],
    { settings: { title: null, keep: [1, true] }, untouched: false },
    { settings: { name: null, keep: [1, true] }, untouched: false },
  )
  let lens = document([{
    rename: { from: ['literal.dot', 'a'], to: ['literal.dot', 'b'] },
  }])
  equal(lens.put({ 'literal.dot': { a: 0 } }), { 'literal.dot': { b: 0 } })
  let untouched = { settings: { keep: [] } }
  ok(lens.put(untouched) === untouched)
  ok(lens.get(null) === null)
  ok(document([]).put(5) === 5)
})

test('hoist and plunge compose and reverse without changing neighboring data', () => {
  roundtrip(
    [
      { hoist: { from: 'a.b.value', to: 'a.value' } },
      { plunge: { from: 'a.value', to: 'a.c.title' } },
    ],
    { a: { b: { value: 'cake' }, c: {}, keep: 1 } },
    { a: { b: {}, c: { title: 'cake' }, keep: 1 } },
  )
})

test('default operations preserve omission and refuse loss of nondefault data', async () => {
  roundtrip(
    [{ remove: { path: 'obsolete', default: false } }, {
      add: { path: 'mode', default: 'safe' },
    }],
    { obsolete: false, keep: null },
    { mode: 'safe', keep: null },
  )
  let add = document([{ add: { path: 'prefs', default: { enabled: false } } }])
  let value = freeze(add.put({}))
  equal(value, { prefs: { enabled: false } })
  let mutable = add.put({}) as { prefs: { enabled: boolean } }
  mutable.prefs.enabled = true
  equal(add.put({}), { prefs: { enabled: false } })
  equal(add.put({ prefs: null }), { prefs: null })
  await throws(() => add.get({ prefs: { enabled: true } }))
  await throws(() =>
    document([{ remove: { path: 'saved', default: {} } }]).put({
      saved: { input: 'precious' },
    })
  )
})

test('concat splits values and consumes sources, with explicit separators and literals', async () => {
  roundtrip(
    [{ concat: { from: ['first', 'last'], to: 'full', separator: ' ' } }],
    { first: 'Ada', last: 'Lovelace', keep: 7 },
    { full: 'Ada Lovelace', keep: 7 },
  )
  roundtrip(
    [{
      concat: {
        from: ['rest', { value: '...' }],
        to: 'positional',
        append: true,
      },
    }],
    { rest: 'files', positional: ['app'] },
    { positional: ['app', 'files...'] },
  )
  let lens = document([{
    concat: {
      from: ['rest', { value: '...' }],
      to: 'positional',
      append: true,
    },
  }])
  equal(lens.get({ positional: ['app'] }), { positional: ['app'] })
  equal(lens.put({ rest: 'files' }), { positional: ['files...'] })
  equal(lens.get({ positional: ['files...'] }), { rest: 'files' })
  let omitted = { keep: 4 }
  ok(lens.put(omitted) === omitted)
  await throws(() =>
    document([{ concat: { from: ['first', 'last'], to: 'full' } }])
  )
  await throws(() =>
    document([{ concat: { from: ['a', 'b'], to: 'c', separator: '/' } }]).put({
      a: 'one/two',
      b: 'three',
    })
  )
  await throws(() => lens.put({ rest: null }))
  await throws(() =>
    document([{ concat: { from: ['a', 'b'], to: 'c', separator: '/' } }]).get({
      c: 'one/two/three',
    })
  )
})

test('scatter gathers by property name or inverted map value and preserves input schemas', async () => {
  roundtrip(
    [{ scatter: { from: 'aliases', to: 'input', keyword: 'short' } }],
    {
      aliases: { limit: 'n' },
      input: { limit: { type: 'number' }, all: { type: 'boolean' } },
    },
    {
      input: {
        limit: { type: 'number', short: 'n' },
        all: { type: 'boolean' },
      },
    },
  )
  roundtrip(
    [{
      scatter: { from: 'aliases', to: 'input', keyword: 'short', key: 'value' },
    }],
    { aliases: { n: 'limit' }, input: { limit: { type: 'number' } } },
    { input: { limit: { type: 'number', short: 'n' } } },
  )
  let lens = document([{
    scatter: { from: 'aliases', to: 'input', keyword: 'short', key: 'value' },
  }])
  await throws(() => lens.put({ aliases: { n: 'missing' }, input: {} }))
  await throws(() =>
    lens.put({ aliases: { n: 'limit' }, input: { limit: { short: 'x' } } })
  )
  await throws(() =>
    lens.get({ input: { a: { short: 'n' }, b: { short: 'n' } } })
  )
})

let declaration: Op[] = [
  { rename: { from: 'options.positional', to: 'positional' } },
  {
    scatter: {
      from: 'options.short',
      to: 'input',
      keyword: 'short',
      key: 'value',
    },
  },
  {
    concat: {
      from: ['options.rest', { value: '...' }],
      to: 'positional',
      append: true,
    },
  },
  { remove: { path: 'options', default: {} } },
]

test('T-64134 declarations from graph, builders and spawn translate both ways as a document', () => {
  let lens = document([{ in: { path: '$defs.*', ops: declaration } }])
  let before = freeze(structuredClone(tools)),
    current = lens.put(before) as {
      $defs: Record<
        string,
        { positional?: string[]; input: Record<string, { short?: string }> }
      >
    }
  equal(current.$defs.graph_query.positional, ['q'])
  equal(current.$defs.graph_query.input.limit.short, 'n')
  equal(current.$defs.graph_show.positional, ['ids...'])
  equal(current.$defs.builder_build.positional, ['builder', 'only...'])
  equal(current.$defs.builder_build.input.model.short, 'm')
  equal(current.$defs.builder_build.input.provider.short, 'p')
  equal(current.$defs.session_spawn.input.provider.short, 'p')
  for (let tool of Object.values(current.$defs)) ok(!('options' in tool))
  equal(lens.get(freeze(current)), tools)
  equal(before, tools)
})

test('nested array documents transform by index and wildcard without mutating inputs', () => {
  roundtrip(
    [{
      in: {
        path: ['items', '*'],
        ops: [{ rename: { from: 'before', to: 'after' } }],
      },
    }],
    { items: [{ before: 'one' }, { before: null }, { keep: true }] },
    { items: [{ after: 'one' }, { after: null }, { keep: true }] },
  )
  roundtrip(
    [{ rename: { from: ['items', 0, 'x'], to: ['items', 0, 'y'] } }],
    { items: [{ x: true }] },
    { items: [{ y: true }] },
  )
})

test('conflicts, malformed paths and irreversible moves refuse without partial mutation', async () => {
  let lens = document([{ rename: { from: 'a.title', to: 'b.title' } }])
  let before = freeze({ a: { title: 'Cake' }, b: { title: 'Other' } })
  await throws(() => lens.put(before))
  equal(before, { a: { title: 'Cake' }, b: { title: 'Other' } })
  await throws(() => document([{ rename: { from: 'a', to: 'a.title' } }]))
  await throws(() => document([{ rename: { from: '', to: 'title' } }]))
  await throws(() => document([{ hoist: { from: 'title', to: 'a.title' } }]))
  await throws(() => lens.put({ a: { title: 'Cake' }, b: null }))
})

test('JSON prototype names stay ordinary keys through paths and scatter in both directions', () => {
  let old = JSON.parse('{"constructor":{"polluted":true},"safe":"ok"}') as Json
  let current = JSON.parse(
    '{"__proto__":{"polluted":true},"safe":"ok"}',
  ) as Json
  roundtrip(
    [{ rename: { from: 'constructor', to: '__proto__' } }],
    old,
    current,
  )
  let renamed = document([{ rename: { from: 'constructor', to: '__proto__' } }])
    .put(old)
  ok(Object.hasOwn(renamed as object, '__proto__'))
  ok(Object.getPrototypeOf(renamed) === Object.prototype)

  roundtrip(
    [{ scatter: { from: 'aliases', to: 'input', keyword: '__proto__' } }],
    JSON.parse(
      '{"aliases":{"constructor":"c","__proto__":"p"},"input":{"constructor":{"type":"string"},"__proto__":{"type":"number"}}}',
    ),
    JSON.parse(
      '{"input":{"constructor":{"type":"string","__proto__":"c"},"__proto__":{"type":"number","__proto__":"p"}}}',
    ),
  )
  roundtrip(
    [{
      scatter: { from: 'aliases', to: 'input', keyword: 'short', key: 'value' },
    }],
    JSON.parse(
      '{"aliases":{"__proto__":"constructor"},"input":{"constructor":{"type":"string"}}}',
    ),
    JSON.parse(
      '{"input":{"constructor":{"type":"string","short":"__proto__"}}}',
    ),
  )
  let added = document([{
    add: { path: 'constructor.prototype.polluted', default: true },
  }]).put({})
  equal(added, { constructor: { prototype: { polluted: true } } })
  equal(({} as Record<string, unknown>).polluted, undefined)
})
