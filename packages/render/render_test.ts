// Registry behavior against one small vocabulary: selection never renders or
// runs an action, and a column declaration is independent of its stored value.

import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { and, parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import {
  actions,
  applicable,
  define,
  extend,
  type Renderer,
  resolve,
} from './mod.ts'

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

Deno.test('an unknown view name resolves to nothing, not to a prototype key', () => {
  let tile = face('Tile', true)
  let registry = define([tile])
  assertEquals(resolve(registry, bundle, 'toString', vocab), undefined)
  assertStrictEquals(resolve(registry, bundle, 'Card.Tile', vocab), tile)
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
  assertEquals(
    resolve(registry, bundle, 'Tile', vocab, { comp: 'doc' })?.view,
    'Tile',
  )
  assertThrows(() => resolve(registry, bundle, 'Edit', vocab, { col: 'title' }))
  assertThrows(() =>
    resolve(registry, bundle, 'Edit', vocab, { comp: 'doc', col: 'missing' })
  )
})

Deno.test('a column pick is remembered per registry, and an overlay replaces it', () => {
  let plain = face('Edit', '.column.type=string')
  let registry = define([plain])
  let ask = () =>
    resolve(registry, bundle, 'Edit', vocab, { comp: 'doc', col: 'title' })
  assertStrictEquals(ask(), plain)
  assertStrictEquals(ask(), plain)
  let titles = face('Edit', '.column.comp=doc, .column.col=title')
  extend(registry, [titles])
  assertStrictEquals(ask(), titles)
  // Two columns of the same type are different asks, never one another's answer.
  let ranks = face('Edit', '.column.type=number')
  extend(registry, [ranks])
  assertStrictEquals(ask(), titles)
  assertStrictEquals(
    resolve(registry, bundle, 'Edit', vocab, { comp: 'task', col: 'rank' }),
    ranks,
  )
  // The same address under a second vocabulary is a different declaration.
  let other = loadVocab([{
    $defs: {
      doc: { type: 'object', properties: { title: { type: 'number' } } },
    },
  }])
  let byType = define([plain, ranks])
  let title = { comp: 'doc', col: 'title' }
  assertStrictEquals(resolve(byType, bundle, 'Edit', vocab, title), plain)
  assertStrictEquals(resolve(byType, bundle, 'Edit', other, title), ranks)
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

Deno.test('host registrations preserve payloads; overlays and tabs share matching', () => {
  let original = {
    view: 'Tile',
    match: parse('.doc'),
    Render: () => 'doc',
    file: { ext: 'md' },
  }
  let specific = {
    ...original,
    match: parse('.doc .task'),
    Render: () => 'task',
  }
  let json = { ...original, view: 'JSON', match: true as const }
  let overlay = { ...original, Render: () => 'overlay' }
  let registry = define([original, json], {
    views: ['Missing', 'Tile', 'JSON'],
  })
  assertStrictEquals(
    resolve(registry, bundle, 'Tile', vocab)?.Render,
    original.Render,
  )
  assertStrictEquals(
    resolve(registry, bundle, 'Tile', vocab)?.file,
    original.file,
  )
  extend(registry, [overlay])
  assertStrictEquals(resolve(registry, bundle, 'Tile', vocab), overlay)
  extend(registry, [specific])
  extend(registry, [original])
  assertStrictEquals(resolve(registry, bundle, 'Tile', vocab), specific)
  assertEquals(applicable(registry, bundle, vocab), ['Tile', 'JSON'])
  assertEquals(applicable(registry, { entity: bundle.entity }, vocab), ['JSON'])
  assertEquals(applicable(define([original, original, json]), bundle, vocab), [
    'Tile',
    'JSON',
  ])
  assertEquals(resolve(define([original]), bundle, 'Tile', vocab), original)
})

Deno.test('dynamic typed actions receive their source and refresh without running', () => {
  type Source = { title: string }
  type Verb = { label: string; run: () => void }
  let runs = 0
  let run = () => {
    runs++
  }
  let source = { title: 'Before' }
  let registry = define<Renderer, Verb, Source>([], {
    vocab,
    actions: [
      { match: parse('.task'), acts: (e) => [{ label: e.title, run }] },
      {
        match: parse('.doc.title=missing'),
        acts: () => {
          throw new Error('unmatched factory ran')
        },
      },
      {
        match: true,
        acts: () => [
          { label: 'delete', run },
          { label: 'delete', run },
          { label: 'conditional', when: parse('.task.status=done'), run },
        ],
      },
    ],
  })
  assertEquals(actions(registry, bundle, vocab, source).map((a) => a.label), [
    'Before',
    'delete',
    'delete',
  ])
  source.title = 'After'
  assertEquals(
    actions(registry, bundle, undefined, source).map((a) => a.label),
    ['After', 'delete', 'delete'],
  )
  assertEquals(runs, 0)
  actions(registry, bundle, vocab, source)[0].run()
  assertEquals(runs, 1)
  let portable = define([], {
    actions: [{
      match: true,
      acts: (b) => [{ name: b.entity.eid, run: () => ({}) }],
    }],
  })
  assertEquals(actions(portable, bundle)[0].name, bundle.entity.eid)
})
