import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { edit } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    doc: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
        priority: { type: 'number', format: 'priority' },
        state: { enum: ['open', 'done'], aliases: { finished: 'done' } },
        owner: { type: 'string', ref: 'entity', death: 'detach' },
        at: { type: 'string', format: 'date-time' },
        enabled: { type: 'boolean' },
        data: { type: 'string', format: 'json' },
        updated: { type: 'string', stamped: true },
        rank: { type: 'number', persist: false },
      },
    },
    spine: { wire: false, properties: { num: { type: 'number' } } },
  },
})
let bundle = { entity: { eid: 'a' }, doc: { title: 'Before', count: 2 } }
let set = (col: string, input: unknown) =>
  edit(vocab, { comp: 'doc', col }).run(bundle, input)

Deno.test('column actions parse typed values and patch only their column', () => {
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
  for (let [col, input, expected] of cases) {
    assertEquals(set(col, input), { doc: { [col]: expected } }, col)
  }
  assertEquals(bundle.doc, { title: 'Before', count: 2 })
})

Deno.test('invalid input and read-only columns never produce patches', () => {
  for (
    let [col, input] of [
      ['title', {}],
      ['count', 'NaN'],
      ['count', 'Infinity'],
      ['count', '0x10'],
      ['count', ' '],
      ['state', 'missing'],
      ['owner', ' '],
      ['at', 'tomorrow'],
      ['at', '2026-09-08T12:00:00'],
      ['enabled', 'maybe'],
      ['data', '{'],
      ['data', { count: 2 }],
      ['updated', 'now'],
      ['rank', 2],
    ] as [string, unknown][]
  ) {
    assertThrows(() => set(col, input), Error, `doc.${col}`)
  }
  assertThrows(() => edit(vocab, { comp: 'doc', col: 'missing' }))
  assertThrows(() => edit(vocab, { comp: 'spine', col: 'num' }).run(bundle, 3))
})

Deno.test('applications can parse and validate without changing the write path', () => {
  let calls: string[] = []
  let action = edit(vocab, { comp: 'doc', col: 'count' }, {
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
    edit(vocab, { comp: 'doc', col: 'count' }, { parse: () => 'wrong' })
      .run(bundle, 1)
  )
})
