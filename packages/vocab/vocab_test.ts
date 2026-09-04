// The runtime over the hand-authored fleet slice: interrogation, routing,
// kinds, deaths, and instance checks — every answer over the LOADED instance,
// no global vocabulary anywhere.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { kindOrder, loadVocab } from './mod.ts'
import slice from './fleet/slice.schema.json' with { type: 'json' }

let v = loadVocab(slice)

Deno.test('comps are alphabetical and the spine stays unwritable', () => {
  assertEquals(v.comps, [...v.comps].sort())
  assert(v.all.includes('entity'))
  assert(!v.comps.includes('entity')) // wire: false
  assertEquals(v.comp('entity')?.stamped, ['num'])
})

Deno.test('columns interrogate to their whole shape', () => {
  assertEquals(v.column('task', 'priority'), {
    comp: 'task',
    prop: 'priority',
    category: 'scalar',
    scalar: 'priority',
    values: undefined,
    aliases: undefined,
    ref: undefined,
    death: undefined,
    stamped: false,
    persist: true,
    store: undefined,
    affinity: 'real',
    fk: false,
  })
  let target = v.column('comment', 'target')!
  assertEquals(
    [target.category, target.ref, target.death, target.affinity, target.fk],
    ['ref', 'entity', 'cascade', 'integer', true],
  )
  // a kept reference carries no foreign key
  assertEquals(v.column('memory', 'scope')!.fk, false)
  // a body is a blob-backed string column
  let body = v.column('doc', 'body')!
  assertEquals([body.scalar, body.store, body.affinity], [
    'body',
    'blob',
    'text',
  ])
  // scalars reconstruct from native type+format
  assertEquals(v.column('board', 'query')!.scalar, 'query')
  assertEquals(v.column('claim', 'claimed_at')!.scalar, 'time')
  assertEquals(v.column('role', 'state')!.values![0], 'running')
})

Deno.test('stamped columns are readable, never writable', () => {
  let claim = v.comp('claim')!
  assertEquals(claim.writable, ['session'])
  assertEquals(claim.stamped, ['claimed_at'])
  assertEquals(v.columns('claim'), ['session', 'claimed_at'])
  assert(v.column('claim', 'claimed_at')!.stamped)
})

Deno.test('bare props route to their home', () => {
  assertEquals(v.route('title'), { comp: 'doc', prop: 'title' })
  assertEquals(v.route('query'), { comp: 'board', prop: 'query' })
  assertEquals(v.route('color'), { comp: 'project', prop: 'color' })
  // several owners, all references: one read concept, comp ''
  assertEquals(v.route('target'), { comp: '', prop: 'target' })
  // a component name is a facet
  assertEquals(v.route('task'), { comp: 'task', prop: '' })
  assertThrows(() => v.route('nonsense'), Error, 'unknown prop')
})

Deno.test('dotted paths aim to hops', () => {
  assertEquals(v.aim('comment.target.doc.title'), [
    { comp: 'comment', prop: 'target' },
    { comp: 'doc', prop: 'title' },
  ])
  // the bare spelling of the same traversal
  assertEquals(v.aim('assignee.title'), [
    { comp: 'task', prop: 'assignee' },
    { comp: 'doc', prop: 'title' },
  ])
  assertThrows(
    () => v.aim('doc.nope'),
    Error,
    'doc has title (text), body (body)',
  )
})

Deno.test('kindOf takes the most specific kind, entity as the floor', () => {
  assertEquals(v.kindOf({ task: 1, doc: 1 }), 'task')
  assertEquals(v.kindOf({ doc: 1, alias: 1 }), 'doc')
  assertEquals(v.kindOf({ blob: 1 }), 'entity') // blob is not a kind
  assertEquals(v.kindOf({}), 'entity')
  // the constraints hold in the derived order
  let at = (k: string) => v.kinds.indexOf(k)
  assert(at('task') < at('doc'))
  assert(at('project') < at('board'))
  assert(at('notice') < at('doc'))
  assert(at('doc') < at('alias'))
})

Deno.test('death worklists derive from the declarations', () => {
  let cascade = v.deaths('cascade')
  assert(cascade.some(([c, p]) => c == 'comment' && p == 'target'))
  let keep = v.deaths('keep')
  assert(keep.some(([c, p]) => c == 'memory' && p == 'scope'))
  // stamped refs stay out of the wire's cascade…
  assert(!keep.some(([c, p]) => c == 'role' && p == 'observed'))
  // …but are still reference columns
  assert(v.refCols().some(([c, p]) => c == 'role' && p == 'observed'))
})

Deno.test('fleet keywords are carried, not acted on', () => {
  assertEquals(v.comp('task')?.prefix, 'T')
  assertEquals(v.comp('project')?.byName, true)
  assertEquals(v.comp('comment')?.prefix, undefined)
})

Deno.test('instances check against the loaded shape', () => {
  assertEquals(v.check('task', { priority: 1, domain: 'Eng' }), [])
  assertEquals(v.check('task', { priority: 'high' }), [
    'task.priority is a number',
  ])
  assert(v.check('task', { bogus: 1 })[0].includes('task has'))
  // stamped columns refuse a write unless asked for
  assert(v.check('claim', { claimed_at: 'now' }).length == 1)
  assertEquals(v.check('claim', { claimed_at: 'now' }, { stamped: true }), [])
  assertEquals(v.check('notice', { event: 'wake' }), [])
  assert(v.check('notice', { event: 'boom' })[0].includes('one of'))
  assert(v.check('task', { domain: { nested: 1 } })[0].includes('scalar'))
})

Deno.test('a computed column reads but never writes', () => {
  let w = loadVocab({
    $defs: {
      task: {
        type: 'object',
        kind: true,
        properties: {
          priority: { type: 'number' },
          status: { enum: ['open', 'done'], persist: false },
        },
      },
    },
  })
  assertEquals(w.comp('task')?.writable, ['priority'])
  assertEquals(w.route('status'), { comp: 'task', prop: 'status' })
  assertEquals(w.column('task', 'status')?.persist, false)
  assert(w.check('task', { status: 'open' }).length == 1)
})

Deno.test('the order refuses cycles and unknown kinds', () => {
  assertThrows(
    () => kindOrder(['a', 'b'], (k) => (k == 'a' ? ['b'] : ['a'])),
    Error,
    'cycle',
  )
  assertThrows(() => kindOrder(['a'], () => ['ghost']), Error, 'not a kind')
})

Deno.test('a word has one home across documents', () => {
  assertThrows(
    () => loadVocab([slice, { $defs: { doc: { type: 'object' } } }]),
    Error,
    'declared twice',
  )
})
