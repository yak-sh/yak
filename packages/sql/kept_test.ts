// A kept statement answers what the binder would, whatever a caller changes
// between calls: operands, options, the clock, the catalog, the extensions.
import { equal, ok, test } from '@yaks/testing'
import {
  and,
  eq,
  gt,
  le,
  limit,
  list,
  or,
  order,
  type Pred,
  present,
  time,
} from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { bind, type BindOpts } from './bind.ts'
import {
  as,
  compile,
  type Extension,
  lit,
  type Screen,
  select,
  val,
} from './mod.ts'
import { render } from './render.ts'

let vocab = loadVocab({
  $defs: {
    link: {
      component: true,
      properties: {
        left: { type: 'string', ref: 'entity' },
        right: { type: 'string', ref: 'entity' },
      },
    },
    mark: {
      component: true,
      properties: { owner: { type: 'string', ref: 'entity' } },
    },
    one: { component: true },
    two: { component: true },
  },
})
let eid = (n: number) =>
  `11111111-1111-1111-1111-${n.toString(16).padStart(12, '0')}`
let query = (a: string, b = a) =>
  and(or(
    eq('link.left', list(a)),
    eq('link.right', list(b)),
    eq('mark.owner', list(a)),
  ))
let same = (
  q: ReturnType<typeof and>,
  opts: BindOpts = {},
  expected?: ReturnType<typeof render>,
) => {
  let actual = compile(q, vocab, opts)
  expected ??= render(bind(q, vocab, opts))
  equal([actual.sql, actual.params], [expected.sql, expected.params])
  if (actual.origin) equal(render(actual.origin).sql, actual.sql)
  return actual
}

for (let [a, b] of [[1, 1], [2, 2], [2, 3], [3, 2], [4, 4]]) {
  test(`reference operands retain identity: ${a}, ${b}`, () => {
    same(query(eid(a), eid(b)))
  })
}

test('a list of ids asked again with others binds the others', () => {
  same(and(eq('entity.eid', list(eid(5), eid(6)))))
  same(and(eq('entity.eid', list(eid(7), eid(8)))))
})

test('an edited identity AST binds its current operand', () => {
  let q = and(eq('entity.eid', eid(1)))
  same(q)
  ;(q.clauses[0] as Pred).value = { kind: 'scalar', raw: eid(2) }
  same(q)
})

// The options each row below starts from, compiled once on their own: the
// rows share that plan, and each checks it again before its change.
let start = (storageOrder: boolean): BindOpts => ({
  references: { [eid(1)]: 1, [eid(2)]: 1 },
  storageOrder,
})
for (let order of [false, true]) {
  test(`reference bindings start from their options: storage order ${order}`, () => {
    same(query(eid(1), eid(2)), start(order))
  })
}

for (
  let [name, change] of [
    ['integer', (opts: BindOpts) => {
      opts.references![eid(1)] = 2
    }],
    ['null', (opts: BindOpts) => {
      opts.references![eid(2)] = null
    }],
    ['unresolved and ordered', (opts: BindOpts) => {
      delete opts.references![eid(1)]
      opts.storageOrder = true
    }],
    ['replaced map', (opts: BindOpts) => {
      opts.references = { [eid(1)]: 2, [eid(2)]: 2 }
      opts.storageOrder = false
    }],
  ] as const
) {
  test(`reference bindings follow mutable options: ${name}`, () => {
    let opts = start(name == 'replaced map')
    let q = query(eid(1), eid(2))
    same(q, opts)
    change(opts)
    same(q, opts)
  })
}

test('an answer a caller changes leaves the next one whole', () => {
  let q = query(eid(7))
  for (let k = 0; k < 2; k++) {
    let answer = same(q)
    answer.sql = 'changed'
    answer.params.fill('changed')
  }
  same(query(eid(8)))
})

// A text extension that counts the queries it begins and keeps the last
// screen it was given.
type Begun = { begun: number; screen?: Screen }
let text = (said: Begun): Extension => ({
  name: 'text',
  begin: (s) => {
    said.begun++
    said.screen = s
  },
  compile: { text: () => val(true) },
})

test('unused extensions begin each query with its current screen', () => {
  let said: Begun = { begun: 0 }
  let opts: BindOpts = { extend: [text(said)], references: { [eid(1)]: 1 } }
  compile(query(eid(1)), vocab, opts)
  opts.references = { [eid(2)]: 9 }
  compile(query(eid(2)), vocab, opts)
  equal(said.begun, 2)
  equal(
    said.screen!()!.params,
    render(bind(query(eid(2)), vocab, { references: opts.references })).params,
  )
  equal(said.begun, 2)
})

test('an extension that comes to compile predicates is asked every time', () => {
  let said: Begun = { begun: 0 }
  let extension = text(said)
  let opts: BindOpts = { extend: [extension], references: { [eid(2)]: 9 } }
  let q = and(eq('link.left', eid(3)))
  compile(q, vocab, opts)
  let intercepted = 0
  extension.compile.pred = () => val(++intercepted)
  equal(compile(q, vocab, opts).params, [1])
  equal(compile(q, vocab, opts).params, [2])
  equal(said.begun, 3)
})

test('a begin hook that intercepts a warmed predicate runs once', () => {
  let begun = 0, intercept = false
  let extension: Extension = {
    name: 'changing',
    compile: {},
    begin: () => {
      begun++
      if (intercept) extension.compile.pred = () => val(1)
    },
  }
  let q = and(eq('link.right', eid(4))), opts = { extend: [extension] }
  compile(q, vocab, opts)
  intercept = true
  equal(compile(q, vocab, opts).params, [1])
  equal(begun, 2)
})

// A begin hook that changes the options' reference map: compiled with a
// reference plan and without, the answers agree, and the screen sees the map
// as begin left it.
let hooked = (value: number, replace: boolean, cached: boolean) => {
  let q = and(eq('mark.owner', eid(1)))
  let begun = 0, screen: Screen | undefined
  let opts: BindOpts = { references: { [eid(1)]: value } }
  opts.extend = [{
    name: 'references',
    compile: {},
    begin: (s) => {
      begun++
      screen = s
      if (replace) opts.references = { [eid(1)]: 9 }
      else opts.references![eid(1)] = 9
    },
  }]
  let out = cached ? compile(q, vocab, opts) : render(bind(q, vocab, opts))
  equal(begun, 1)
  equal(screen!()!.params, [9])
  return [out.sql, out.params]
}

test('begin preserves captured reference maps it replaces', () => {
  for (let value of [1, 2]) {
    equal(hooked(value, true, true), hooked(value, true, false))
  }
})

test('begin sees in-place changes to captured reference maps', () => {
  equal(hooked(3, false, true), hooked(3, false, false))
})

let words = loadVocab([...vocab.docs, {
  $defs: {
    virtual: {
      component: true,
      computed: true,
      properties: { value: { type: 'string' } },
    },
  },
}])

for (let mutate of ['spine', 'eids'] as const) {
  test(`begin restrictions use live options without rebuilding the captured spine: ${mutate}`, () => {
    let active = false, begun = 0
    let q = and(eq('link.left', eid(1)))
    let opts: BindOpts = {
      backed: {
        virtual: {
          tag: '0'.repeat(32),
          rows: select({
            cols: [as(lit(1), 'entity'), as(lit(eid(1)), 'value')],
          }),
        },
      },
      extend: [{
        name: 'mutating',
        compile: {},
        begin: () => {
          begun++
          if (!active) return
          if (mutate == 'eids') opts.eids = [eid(2)]
          else (q.clauses[0] as Pred).path = ['virtual', 'value']
        },
      }],
    }
    compile(q, words, opts)
    active = true
    let output = compile(q, words, opts)
    equal(begun, 2)
    opts.eids = undefined
    ;(q.clauses[0] as Pred).path = ['link', 'left']
    let expected = render(bind(q, words, opts))
    equal([output.sql, output.params], [expected.sql, expected.params])
  })
}

test('begin rewrites retain the ordinary binder refusal', () => {
  let q = and(eq('link.right', eid(1))), active = false
  let opts: BindOpts = {
    extend: [{
      name: 'refusal',
      compile: {},
      begin: () => {
        if (active) (q.clauses[0] as Pred).path = ['missing', 'value']
      },
    }],
  }
  compile(q, vocab, opts)
  active = true
  let refused = (compile: () => unknown) => {
    ;(q.clauses[0] as Pred).path = ['link', 'right']
    try {
      compile()
    } catch (e) {
      return [(e as Error).name, (e as Error).message]
    }
  }
  let expected = refused(() => bind(q, vocab, opts))
  ok(expected)
  equal(refused(() => compile(q, vocab, opts)), expected)
})

for (
  let [name, q, opts] of [
    ['list', and(eq('link.left', list(eid(1), eid(2)))), {}],
    ['window', and(eq('link.left', eid(1)), limit(1)), {
      references: { [eid(1)]: 1 },
    }],
    ['derived', and(eq('link.left', eid(1))), {
      derived: { 'link.left': { tag: 'eid', expr: () => val(eid(2)) } },
    }],
    ['visibility', and(eq('link.left', eid(1))), {
      visibility: { entity: `.entity.eid=${eid(2)}` },
    }],
    ['candidates', and(eq('link.left', eid(1))), { eids: [eid(2)] }],
    ['human identity', and(eq('entity.eid', '0'.repeat(40))), {}],
  ] as [string, ReturnType<typeof and>, BindOpts][]
) {
  // The binder's answer, worked out as the file loads: the case times the
  // three asks, the third the kept statement's first hit.
  let expected = render(bind(q, vocab, opts))
  test(`${name} shapes answer as the binder does, asked again`, () => {
    for (let k = 0; k < 3; k++) same(q, opts, expected)
  })
}

test('declined list shapes retain changing operands', () => {
  same(and(eq('link.left', list(eid(3), eid(4)))))
})

test('catalog-sensitive predicates read each current snapshot', () => {
  let id = 1, asked = 0
  let archetypes = Object.assign(() => {
    asked++
    return [id]
  }, { held: true })
  let opts = { archetypes }
  let q = and(present('one'), present('two'), eq('link.left', eid(1)))
  let first = compile(q, vocab, opts)
  id = 2
  let second = compile(q, vocab, opts)
  ok(asked >= 2)
  ok(
    first.sql != second.sql ||
      JSON.stringify(first.params) != JSON.stringify(second.params),
  )
})

test('reference queries follow the current catalog held mode', () => {
  let archetypes = Object.assign(() => [1], { held: true })
  let opts = { archetypes }
  same(and(eq('link.left', eid(1))), opts)
  archetypes.held = false
  same(and(eq('link.left', eid(2))), opts)
})

// A shape asked at several moments, and with several root sets: each answer
// is the binder's own. The phrases include ones that round to a day, an hour
// or a month, which no fixed offset from the clock can stand for. A shape's
// second call is the first one bound into its kept statement.
let timed = loadVocab([...vocab.docs, {
  $defs: {
    run: {
      component: true,
      properties: {
        next: { type: 'string', format: 'date-time' },
        at: { type: 'number', format: 'date-time' },
        handler: { type: 'string' },
        seq: { type: 'integer' },
      },
    },
  },
}])
let moments = [
  Date.UTC(2026, 9, 20, 23, 59, 59, 999),
  Date.UTC(2028, 2, 31, 3, 4, 5, 6),
]
let timedSame = (q: ReturnType<typeof and>, opts: BindOpts) => {
  let actual = compile(q, timed, opts), expected = render(bind(q, timed, opts))
  equal([actual.sql, actual.params], [expected.sql, expected.params])
}
for (
  let phrase of [
    'now',
    '1 hour ago',
    'in 5m',
    'today',
    'this hour',
    '9am',
    '1 month ago',
    '2 years ago',
    'yesterday..now',
    '2026-10-20',
  ]
) {
  test(`a kept statement follows the clock: ${phrase}`, () => {
    let op = phrase.includes('..') ? eq : le
    let q = and(op('run.next', time(phrase)), op('run.at', time(phrase)))
    for (let now of moments) timedSame(q, { now })
  })
}

for (
  let calls of [
    [[1], [2]],
    [[3, 4], [5, 6]],
    [[7, 7], [8, 8]],
    [[9, 1, 9], [2, 3, 2]],
  ]
) {
  test(`a kept statement binds each call's roots: ${calls[0]}`, () => {
    let q = and(eq('run.handler', 'h'), le('run.next', time('now')))
    for (let ids of calls) timedSame(q, { now: moments[0], eids: ids.map(eid) })
  })
}

for (
  let calls of [[[1, 2], [3, 4]], [[7, 7], [8, 8]], [[8, 9, 10], [1, 2, 3]]]
) {
  test(`a kept statement binds lists of ids it excludes: ${calls[0]}`, () => {
    for (let ids of calls) {
      let q = and(eq('run.handler', 'h'), {
        kind: 'pred',
        path: ['entity', 'eid'],
        op: '!=',
        value: list(...ids.map(eid)),
      } as Pred, limit(1))
      timedSame(q, { now: moments[0], unordered: true })
    }
  })
}

// Each call's bounds on a number, asked in turn of one shape: a cursor read
// from the line after the last one read.
for (let calls of [[5, 6, 70], [0, 1, 2], [7, 7, 8], [9, 3, 2 ** 40]]) {
  test(`a kept statement binds each call's bounds on a number: ${calls}`, () => {
    for (let [k, n] of calls.entries()) {
      let q = and(
        gt('run.seq', n),
        le('run.seq', calls[(k + 1) % calls.length]),
        eq('run.handler', 'h'),
      )
      timedSame(q, { now: moments[0] })
    }
  })
}

test('a kept statement stops standing when the catalog answers otherwise', () => {
  let ids = [1]
  let archetypes = Object.assign(() => ids, { held: true })
  let q = and(present('one'), present('two'), eq('link.left', eid(1)))
  for (let next of [[1], [1], [2]]) {
    ids = next
    same(q, { archetypes })
  }
})

test('a kept statement takes the road its census chooses now', () => {
  let held = 19_000
  let census = { held: () => held, largest: () => 3.2e6 }
  let q = and(present('one'), order('entity.eid'), limit(1))
  let roads = new Set<string>()
  for (let next of [19_000, 19_000, 19_000, 10, 10]) {
    held = next
    roads.add(same(q, { census }).sql)
  }
  equal(roads.size, 2)
})
