import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import {
  type Action,
  type Child,
  define,
  edit,
  editors,
  extend,
  type H,
  properties,
  resolve,
} from './mod.ts'

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

Deno.test('property actions parse typed values and patch only their property', () => {
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

Deno.test('invalid input and read-only properties never produce patches', () => {
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

Deno.test('applications can parse and validate without changing the write path', () => {
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

type Node = {
  tag: string
  props: Record<string, unknown> | null
  children: Child<Node>[]
}
let h: H<Node> = (tag, props, ...children) => ({ tag, props, children })

Deno.test('seven Edit families select by declaration with no stored value', () => {
  let family = editors(vocab)
  let registry = define(family)
  let empty = { entity: { eid: 'empty' } }
  let cases = [
    ['title', 'input', 'text'],
    ['count', 'input', 'number'],
    ['state', 'select', undefined],
    ['owner', 'input', 'text'],
    ['at', 'input', 'text'],
    ['enabled', 'input', 'checkbox'],
    ['data', 'textarea', undefined],
  ]
  assertEquals(family.length, 7)
  for (let [i, [prop, tag, type]] of cases.entries()) {
    let ctx = { comp: 'doc', prop }
    let renderer = resolve(registry, empty, 'Form.Edit', vocab, ctx)!
    assertStrictEquals(renderer, family[i])
    let node = renderer.render(empty, h, ctx)
    assertEquals(node.tag, tag)
    assertEquals(node.props?.type, type)
    assertEquals(node.props?.['aria-label'], `doc.${prop}`)
    assertEquals(node.props?.value ?? node.props?.checked, i == 5 ? false : '')
  }
  assertStrictEquals(
    resolve(registry, empty, 'Edit', vocab, { comp: 'doc', prop: 'priority' }),
    family[1],
  )
})

Deno.test('enum controls use the vocabulary and offer inert patch actions', () => {
  let registry = define(editors(vocab))
  let ctx = { comp: 'doc', prop: 'state' }
  let node = resolve(registry, bundle, 'Edit', vocab, ctx)!
    .render(bundle, h, ctx)
  let choices = node.children.flat() as Node[]
  assertEquals(choices.map((n) => n.props?.value), ['', 'open', 'done'])
  assertEquals((node.props?.onChange as Action).run(bundle, 'done'), {
    doc: { state: 'done' },
  })
  assertEquals(bundle.doc, { title: 'Before', count: 2 })
})

Deno.test('empty and case-distinct enum members keep their declared values', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        component: true,
        properties: { state: { type: 'string', enum: ['', '_', 'A', 'a'] } },
      },
    },
  })
  let registry = define(editors(vocab))
  let ctx = { comp: 'doc', prop: 'state' }
  let node = resolve(registry, bundle, 'Edit', vocab, ctx)!
    .render(bundle, h, ctx)
  let choices = node.children.flat() as Node[]
  assertEquals(choices.map((n) => n.props?.value), ['__', '', '_', 'A', 'a'])
  assertEquals(node.props?.value, '__')
  let action = node.props?.onChange as Action
  for (let [input, value] of [['__', null], ['', ''], ['a', 'a'], ['A', 'A']]) {
    assertEquals(action.run(bundle, input), { doc: { state: value } })
  }
})

Deno.test('property overlays use ordinary specificity and suffix resolution', () => {
  let registry = define(editors(vocab))
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
    'input',
  )
})

Deno.test('Props lays out every declared property and delegates its editor', () => {
  let registry = define([...editors(vocab), properties(vocab)])
  let props = resolve(registry, bundle, 'Props', vocab, { comp: 'doc' })!
  let calls: unknown[] = []
  let node = props.render(bundle, h, {
    comp: 'doc',
    render: (view, ctx) => {
      calls.push([view, ctx])
      return h('span', null, ctx?.prop)
    },
  })
  assertEquals(node.tag, 'dl')
  assertEquals(
    calls,
    vocab.props('doc').map((prop) => ['Edit', { comp: 'doc', prop }]),
  )
  assertThrows(() => props.render(bundle, h, { comp: 'missing' }))
  assertThrows(() => props.render(bundle, h, { comp: 'doc' }), Error, 'host')
  for (let prop of ['updated', 'rank']) {
    let ctx = { comp: 'doc', prop }
    let node = resolve(registry, bundle, 'Edit', vocab, ctx)!
      .render(bundle, h, ctx)
    assertEquals(node.tag, 'span')
    assertEquals(node.props?.onChange, undefined)
  }
})
