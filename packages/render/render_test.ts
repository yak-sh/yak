// Registry behavior against one small vocabulary: selection never renders or
// runs an action, and a column declaration is independent of its stored value.

import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { and, parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { actions, define, type Renderer, resolve } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: {
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    task: {
      type: 'object',
      properties: {
        rank: { type: 'number' },
        done: { type: 'boolean' },
        status: { enum: ['open', 'done'] },
        at: { type: 'string', format: 'date-time' },
        owner: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
  },
}])
let bundle = {
  entity: { eid: 'a' },
  doc: { title: 'A task' },
  task: { rank: 2, done: false, status: 'open' },
}
let face = (view: string, match: string | true): Renderer => ({
  view,
  match: match === true ? true : parse(match),
  render: (_b, h) => h('span', null, view),
})
let pick = (rs: Renderer[], view = 'Tile') =>
  resolve(define(rs), bundle, view, vocab)

Deno.test('all clauses must hold; specificity outranks registration order', () => {
  let plain = face('Tile', '.doc')
  let task = face('Tile', '.doc, .task')
  let wrong = face('Tile', '.doc, .task, .task.rank>3')
  assertStrictEquals(pick([plain, wrong, task]), task)
  assertStrictEquals(pick([task, wrong, plain]), task)
  assertEquals(pick([wrong]), undefined)
})

Deno.test('ties go to the first registration; true is the weakest match', () => {
  let first = face('Tile', '.doc')
  let second = face('Tile', '.task')
  let fallback = face('Tile', true)
  assertStrictEquals(pick([fallback, first, second]), first)
  assertStrictEquals(pick([second, first]), second)
  assertStrictEquals(pick([fallback]), fallback)
  let empty = { ...first, match: and() }
  assertStrictEquals(pick([fallback, empty]), empty)
  assertStrictEquals(pick([empty, first, fallback]), first)
})

Deno.test('closest role wins before specificity; leftmost qualifiers strip', () => {
  let tile = face('Tile', '.doc, .task')
  let list = face('List.Tile', '.doc')
  let board = face('Board.List.Tile', true)
  let wrongRole = face('Board.List', '.doc, .task')
  assertStrictEquals(pick([tile, list, board], 'Board.List.Tile'), board)
  assertStrictEquals(pick([tile, list], 'Board.List.Tile'), list)
  assertStrictEquals(pick([tile, wrongRole], 'Board.List.Tile'), tile)
  assertEquals(pick([wrongRole], 'Board.List.Tile'), undefined)
  let miss = face('Board.List.Tile', '.task.rank>3')
  assertStrictEquals(pick([miss, list], 'Board.List.Tile'), list)
})

Deno.test('aliases apply at every walk level, and rename the remaining walk', () => {
  let tile = face('Tile', true)
  let registry = define([tile], {
    aliases: {
      Show: 'Tile',
      'List.Old': 'Tile',
      Legacy: 'Panel.Tile',
      Loop: 'Again.Loop',
    },
  })
  for (let view of ['Show', 'Card.Show', 'Board.List.Old', 'Legacy']) {
    assertStrictEquals(resolve(registry, bundle, view, vocab), tile)
  }
  assertEquals(resolve(registry, bundle, 'Loop', vocab), undefined)
  assertEquals(resolve(registry, bundle, 'toString', vocab), undefined)
})

Deno.test('unnamed views honor the configured list; JSON is an explicit fallback', () => {
  let tile = face('Tile', '.doc')
  let full = face('Full', '.doc, .task')
  let json = face('JSON', true)
  let registry = define([tile, full, json], { views: ['Tile'] })
  assertStrictEquals(resolve(registry, bundle, undefined, vocab), tile)
  assertStrictEquals(
    resolve(define([tile, full]), bundle, undefined, vocab),
    full,
  )
  assertStrictEquals(resolve(registry, bundle, 'Missing', vocab), json)
  assertEquals(resolve(define([]), bundle, 'Missing', vocab), undefined)
})

Deno.test('column types use declared schemas, even when the value is absent', () => {
  let types = ['string', 'number', 'boolean', 'enum', 'time', 'ref']
  let rs = types.map((type) => face('Edit', `.column.type=${type}`))
  let registry = define([face('Tile', '.doc'), face('Edit', true), ...rs])
  let targets = [
    ['doc', 'title'],
    ['task', 'rank'],
    ['task', 'done'],
    ['task', 'status'],
    ['task', 'at'],
    ['task', 'owner'],
  ]
  for (let [i, [comp, col]] of targets.entries()) {
    assertStrictEquals(
      resolve(registry, { entity: { eid: 'empty' } }, 'Edit', vocab, {
        comp,
        col,
      }),
      rs[i],
    )
  }
  let owner = face('Edit', '.column.type=ref, .column.ref=entity')
  assertStrictEquals(
    resolve(define([...rs, owner]), bundle, 'Edit', vocab, {
      comp: 'task',
      col: 'owner',
    }),
    owner,
  )
  assertThrows(() => resolve(registry, bundle, 'Edit', vocab, { comp: 'doc' }))
  assertThrows(() =>
    resolve(registry, bundle, 'Edit', vocab, { comp: 'doc', col: 'missing' })
  )
})

Deno.test('actions union all worn components, preserve duplicates, and never run', () => {
  let ran = 0
  let run = () => {
    ran++
    return { doc: { title: null } }
  }
  let clear = { name: 'clear', run }
  let registry = define([], {
    vocab,
    actions: {
      task: [clear, { name: 'finish', when: parse('.task.status=open'), run }],
      doc: [clear, { name: 'reopen', when: parse('.task.status=done'), run }],
      absent: [{ name: 'absent', run }],
      entity: [{ name: 'delete', run }],
      $actor: [{ name: 'wire', run }],
    },
  })
  assertEquals(
    actions(registry, { ...bundle, $actor: {} }).map((a) => a.name),
    ['clear', 'finish', 'clear', 'delete'],
  )
  assertEquals(
    actions(registry, { entity: bundle.entity, doc: null }).length,
    1,
  )
  assertEquals(ran, 0)
  assertEquals(actions(registry, bundle)[0].run(bundle), {
    doc: { title: null },
  })
  assertEquals(ran, 1)
  let conditional = define([], {
    actions: {
      doc: [
        { name: 'clear', when: parse('.doc'), run },
      ],
    },
  })
  assertThrows(() => actions(conditional, bundle), Error, 'vocabulary')
  assertEquals(actions(conditional, bundle, vocab).length, 1)
})
