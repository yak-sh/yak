import { test } from '@yaks/testing'
import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { define, edit, extend, type H, resolve } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
        priority: { type: 'number', format: 'priority' },
        state: {
          type: 'string',
          enum: ['open', 'done'],
          aliases: { finished: 'done' },
        },
        owner: { type: 'string', ref: 'entity', death: 'detach' },
        at: { type: 'string', format: 'date-time' },
        enabled: { type: 'boolean' },
        data: { type: 'string', format: 'json' },
        updated: { type: 'string', stamped: true },
        rank: { type: 'number', computed: true },
      },
    },
    spine: {
      component: true,
      wire: false,
      properties: { num: { type: 'number' } },
    },
  },
})
let bundle = { entity: { eid: 'a' }, doc: { title: 'Before', count: 2 } }
let set = (prop: string, input: unknown) =>
  edit(vocab, { comp: 'doc', prop }).run(bundle, input)

test('property actions parse typed values and patch only their property', () => {
  let cases: [string, unknown, unknown][] = [
    ['title', 'new title', 'new title'],
    ['title', '', ''],
    ['count', '-2.5e2', -250],
    ['count', 0, 0],
    ['count', '', null],
    ['priority', 'P2', 2],
    ['state', 'FINISHED', 'done'],
    ['state', '', null],
    ['owner', ' b ', 'b'],
    ['owner', '', null],
    ['at', '2026-09-08T12:30:00-04:00', '2026-09-08T16:30:00.000Z'],
    ['enabled', false, false],
    ['enabled', 1, true],
    ['data', '{"count":2}', '{"count":2}'],
    ['data', '[false,0]', '[false,0]'],
    ['data', 'null', 'null'],
    ['data', null, null],
  ]
  for (let [prop, input, expected] of cases) {
    assertEquals(set(prop, input), { doc: { [prop]: expected } }, prop)
  }
  assertEquals(bundle.doc, { title: 'Before', count: 2 })
})

test('invalid input and read-only properties never produce patches', () => {
  for (
    let [prop, input] of [
      ['title', {}],
      ['count', 'NaN'],
      ['count', 'Infinity'],
      ['count', '0x10'],
      ['count', ' '],
      ['state', 'missing'],
      ['owner', ' '],
      ['at', 'tomorrow'],
      ['at', '2026-09-08T12:00:00'],
      ['at', '2026-02-31T12:00:00Z'],
      ['at', '2026-09-08T24:00:00Z'],
      ['enabled', 'maybe'],
      ['data', '{'],
      ['data', { count: 2 }],
      ['updated', 'now'],
      ['rank', 2],
    ] as [string, unknown][]
  ) {
    assertThrows(() => set(prop, input), Error, `doc.${prop}`)
  }
  assertThrows(() => edit(vocab, { comp: 'doc', prop: 'missing' }))
  assertThrows(() => edit(vocab, { comp: 'spine', prop: 'num' }).run(bundle, 3))
})

test('applications can parse and validate without changing the write path', () => {
  let calls: string[] = []
  let action = edit(vocab, { comp: 'doc', prop: 'count' }, {
    parse: (input, c, source) => {
      assertEquals(source, bundle)
      calls.push(c.prop)
      return Number(input) * 2
    },
    validate: (value) => {
      if (Number(value) > 10) throw new Error('too many')
    },
  })
  assertEquals(calls, [])
  assertEquals(action.run(bundle, '3'), { doc: { count: 6 } })
  assertThrows(() => action.run(bundle, '6'), Error, 'too many')
  assertThrows(() =>
    edit(vocab, { comp: 'doc', prop: 'count' }, { parse: () => 'wrong' })
      .run(bundle, 1)
  )
})

type Node = { tag: string; props: Record<string, unknown> | null }
let h: H<Node> = (tag, props) => ({ tag, props })

// An editor per declared type, each drawing a tag named for it.
let family = ['string', 'number', 'enum', 'ref', 'time', 'boolean', 'json']
  .map((type) => ({
    view: 'Edit',
    match: parse(`.prop.type=${type}${type == 'number' ? ',priority' : ''}`),
    render: <N>(_b: unknown, h: H<N>) => h(type, null),
  }))

test('a property selects its editor by declaration, with no stored value', () => {
  let registry = define(family)
  let empty = { entity: { eid: 'empty' } }
  let cases = [
    ['title', 'string'],
    ['count', 'number'],
    ['priority', 'number'],
    ['state', 'enum'],
    ['owner', 'ref'],
    ['at', 'time'],
    ['enabled', 'boolean'],
    ['data', 'json'],
  ]
  for (let [prop, tag] of cases) {
    let ctx = { comp: 'doc', prop }
    let renderer = resolve(registry, empty, 'Form.Edit', vocab, ctx)!
    assertEquals(renderer.render(empty, h, ctx).tag, tag)
  }
})

test('property overlays use ordinary specificity and suffix resolution', () => {
  let registry = define(family)
  let custom = {
    view: 'Edit',
    match: parse('.prop.type=string, .prop.comp=doc, .prop.prop=title'),
    render: <N>(_b: unknown, h: H<N>) => h('strong', null, 'custom title'),
  }
  extend(registry, [custom])
  assertStrictEquals(
    resolve(registry, bundle, 'Card.Edit', vocab, {
      comp: 'doc',
      prop: 'title',
    }),
    custom,
  )
  assertEquals(
    resolve(registry, bundle, 'Edit', vocab, { comp: 'doc', prop: 'count' })!
      .render(bundle, h, { comp: 'doc', prop: 'count' }).tag,
    'number',
  )
})
