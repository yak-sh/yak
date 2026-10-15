// Query plans preserve operands and compiler boundaries as callers change them.
import { equal, ok, test } from '@yaks/testing'
import { and, eq, limit, list, or, type Pred, present } from '@yaks/query'
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
import { referenceQuery } from './reference_query.ts'
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
let same = (q: ReturnType<typeof and>, opts: BindOpts = {}) => {
  let actual = compile(q, vocab, opts), expected = render(bind(q, vocab, opts))
  equal([actual.sql, actual.params], [expected.sql, expected.params])
  if (actual.origin) {
    let origin = render(actual.origin)
    equal([origin.sql, origin.params], [actual.sql, actual.params])
  }
  return actual
}

for (let [a, b] of [[1, 1], [2, 2], [2, 3], [3, 2], [4, 4]]) {
  test(`reference operands retain identity: ${a}, ${b}`, () => {
    same(query(eid(a), eid(b)))
  })
}

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

test('reference answers isolate caller mutations, including bound origin fragments', () => {
  let q = query(eid(7)), first = same(q)
  let origin = first.origin!
  first.sql = 'changed'
  first.params.fill('changed')
  if (origin.t == 'select' && origin.where?.t == 'raw') {
    origin.where.params.fill('changed')
  }
  if (origin.t == 'select') {
    origin.cols!.push(val('extra'))
    let from = Array.isArray(origin.from) ? origin.from[0] : origin.from
    if (from?.t == 'table') from.name = 'changed'
    if (from?.t == 'raw') from.sql = 'changed'
    origin.joins?.splice(0)
  }
  same(query(eid(8)))
  same(q)
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
  test(`reference query declines ${name} without changing compilation`, () => {
    equal(referenceQuery(q, vocab, opts), undefined)
    same(q, opts)
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
  equal(referenceQuery(q, vocab, opts), undefined)
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
