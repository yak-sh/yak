// The runtime over the hand-authored fleet slice: interrogation, routing,
// kinds, deaths, and instance checks — every answer over the loaded instance,
// no global vocabulary anywhere.

import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  Ambiguous,
  cast,
  extendMeta,
  kindOrder,
  loadVocab,
  metaSchema,
  Unknown,
} from './mod.ts'
import type { PropSchema, VocabDoc } from './types.ts'
import slice from './fleet/slice.schema.json' with { type: 'json' }

let v = loadVocab(slice)

Deno.test('comps are alphabetical and the spine stays unwritable', () => {
  assertEquals(v.comps, [...v.comps].sort())
  assert(v.all.includes('entity'))
  assert(!v.comps.includes('entity')) // wire: false
  assertEquals(v.comp('entity')?.stamped, ['num'])
})

Deno.test('properties interrogate to their whole shape', () => {
  assertEquals(v.prop('task', 'priority'), {
    comp: 'task',
    prop: 'priority',
    description: undefined,
    category: 'scalar',
    scalar: 'priority',
    values: undefined,
    types: undefined,
    aliases: undefined,
    ref: undefined,
    death: undefined,
    stamped: false,
    search: false,
    computed: false,
    identity: false,
    affinity: 'real',
    fk: false,
    required: false,
    default: undefined,
    keywords: {},
  })
  // What a schema says about a word rides with it, so a door that hands an
  // agent the vocabulary hands over its meaning too.
  assertEquals(
    v.comp('doc')?.description,
    'The written face of an entity: a title and a markdown body.',
  )
  let target = v.prop('comment', 'target')!
  assertEquals(
    [target.category, target.ref, target.death, target.affinity, target.fk],
    ['ref', 'entity', 'cascade', 'integer', true],
  )
  // a kept reference carries no foreign key
  assertEquals(v.prop('memory', 'scope')!.fk, false)
  // where a string property keeps its value is no concern of the meta-model:
  // a body is an ordinary text property here (@yaks/blob owns `store`)
  let body = v.prop('doc', 'body')!
  assertEquals([body.scalar, body.affinity], ['text', 'text'])
  // scalars reconstruct from native type+format
  assertEquals(v.prop('board', 'query')!.scalar, 'query')
  assertEquals(v.prop('claim', 'at')!.scalar, 'time')
  assertEquals(v.prop('role', 'state')!.values![0], 'running')
})

Deno.test('stamped properties are readable, never writable', () => {
  let claim = v.comp('claim')!
  assertEquals(claim.writable, ['session'])
  assertEquals(claim.stamped, ['at'])
  assertEquals(v.props('claim'), ['session', 'at'])
  assert(v.prop('claim', 'at')!.stamped)
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
  // the bare form of the same traversal
  assertEquals(v.aim('assignee.title'), [
    { comp: 'task', prop: 'assignee' },
    { comp: 'doc', prop: 'title' },
  ])
  // the caller's own mistake, so a door answers it as a refusal (a 400)
  assertThrows(
    () => v.aim('doc.nope'),
    Unknown,
    'unknown property: doc.nope — doc has title (string), body (string)',
  )
})

Deno.test('a write naming an undeclared property is told the declared types', () => {
  let v = loadVocab([{
    $defs: {
      meal: {
        component: true,
        properties: {
          at: { type: 'string', format: 'date-time' },
          cook: { type: 'string', ref: 'entity' },
          kind: { type: 'string', enum: ['lunch', 'dinner'] },
          serves: { type: 'integer' },
          tags: { type: ['string', 'array'] },
          vegan: { type: 'boolean' },
        },
      },
    },
  }])
  assertEquals(v.check('meal', { mins: 1 }), [
    'unknown property: meal.mins — meal has at (date-time string), ' +
    'cook (ref entity), kind (lunch|dinner), serves (integer), ' +
    'tags (string|array), vegan (boolean)',
  ])
})

Deno.test('a bare bang aims at the component a property shadows', () => {
  // `project` is both a component and task's reference property. Every form but
  // the bare bang keeps the property — `.project=P-3` must not change meaning.
  assertEquals(v.aim('project'), [{ comp: 'task', prop: 'project' }])
  // `.project!` completes the component sentence: the facet has no other
  // form, while the property keeps its qualified one.
  assertEquals(v.aim('project', true), [{ comp: 'project', prop: '' }])
  assertEquals(v.aim('task.project', true), [{ comp: 'task', prop: 'project' }])
  // a name no component wears is routed as ever
  assertEquals(v.aim('title', true), [{ comp: 'doc', prop: 'title' }])
})

Deno.test('presence can name an undeclared component, comparisons cannot', () => {
  assertEquals(v.aim('invoice', true), [{ comp: 'invoice', prop: '' }])
  assertEquals(v.aim('entity', true), [{ comp: 'entity', prop: '' }])
  assertEquals(v.aim('eid', true), [{ comp: 'entity', prop: 'eid' }])
  assertThrows(() => v.aim('invoice'), Error, 'unknown prop')
  assertThrows(() => v.aim('invoice.total', true), Error, 'unknown prop')
})

Deno.test('the spine routes its own identity, declared or not', () => {
  // no document declares `entity.eid`; the loader routes it because every
  // entity has one — so `.eid=` and `.entity.eid=` name entities
  assertEquals(v.route('eid'), { comp: 'entity', prop: 'eid' })
  assertEquals(v.aim('entity.eid'), [{ comp: 'entity', prop: 'eid' }])
  // it stays out of the property set: identity is not prose, so it reaches no
  // text index, no embedding, and no component's DDL
  assertEquals(v.props('entity').includes('eid'), false)
  assertEquals(v.prop('entity', 'eid'), undefined)
})

Deno.test('reverse associations derive from the reference properties', () => {
  // one reference property: the component's plural names it
  assertEquals(v.assoc('comments'), { comp: 'comment', prop: 'target' })
  // several reference properties: the property disambiguates the plural
  assertEquals(v.assoc('claims'), { comp: 'claim', prop: 'session' })
  assertEquals(v.assoc('nothings'), undefined)
  // a forward name is never shadowed
  assertEquals(v.assoc('task'), undefined)
})

Deno.test('an association names the property when a comp has several refs', () => {
  let w = loadVocab({
    $defs: {
      book: {
        component: true,
        type: 'object',
        properties: { isbn: { type: 'string' } },
      },
      member: {
        component: true,
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      review: {
        component: true,
        type: 'object',
        properties: {
          book: { type: 'string', ref: 'book', death: 'cascade' },
          stars: { type: 'number' },
        },
      },
      loan: {
        component: true,
        type: 'object',
        properties: {
          book: { type: 'string', ref: 'book', death: 'cascade' },
          member: { type: 'string', ref: 'member', death: 'cascade' },
        },
      },
    },
  })
  assertEquals(w.assoc('reviews'), { comp: 'review', prop: 'book' })
  assertEquals(w.assoc('loans_book'), { comp: 'loan', prop: 'book' })
  assertEquals(w.assoc('loans_member'), { comp: 'loan', prop: 'member' })
  assertEquals(w.assoc('loans'), undefined)
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
  // …but are still reference properties
  assert(v.refProps().some(([c, p]) => c == 'role' && p == 'observed'))
})

Deno.test('a registered extension keyword is carried, not interpreted', () => {
  let words = {
    uri: 'https://example.com/vocab/shelf',
    comp: ['prefix', 'by_name'],
    prop: ['format'],
  }
  let w = loadVocab(slice, [words])
  assertEquals(w.keywords, [words])
  assertEquals(w.comp('task')?.keywords, { prefix: 'T' })
  assertEquals(w.comp('project')?.keywords, { prefix: 'P', by_name: true })
  assertEquals(w.comp('comment')?.keywords, {}) // declares none
  assertEquals(w.prop('task', 'priority')?.keywords, { format: 'priority' })
  // unregistered keywords stay invisible
  assertEquals(v.comp('task')?.keywords, {})
  assertEquals(v.prop('task', 'priority')?.keywords, {})
})

Deno.test('the meta-schema composes with an extension vocabulary', () => {
  let words = {
    uri: 'https://example.com/vocab/shelf',
    comp: ['shelf'],
    prop: ['unit'],
    doc: { $defs: { unit: { type: 'string' } } },
  }
  let m = extendMeta([words]) as Record<string, Record<string, unknown>>
  assertEquals(m.$vocabulary['https://example.com/vocab/shelf'], true)
  let props = (k: string) =>
    (m.$defs[k] as { properties: Record<string, unknown> }).properties
  assertEquals(props('component').shelf, true) // named, undescribed
  assertEquals(props('prop').unit, { type: 'string' })
  assert(props('prop').ref) // the core keywords still stand
  // composing leaves the published meta-schema alone
  let core = metaSchema.$defs as Record<string, { properties: object }>
  assert(!('shelf' in core.component.properties))
})

Deno.test('instances check against the loaded shape', () => {
  assertEquals(v.check('task', { priority: 1, domain: 'Eng' }), [])
  assertEquals(v.check('task', { priority: 'high' }), [
    'task.priority is a number',
  ])
  assert(v.check('task', { bogus: 1 })[0].includes('task has'))
  // stamped properties refuse a write unless asked for
  assert(v.check('claim', { at: 'now' }).length == 1)
  assertEquals(v.check('claim', { at: 'now' }, { stamped: true }), [])
  assertEquals(v.check('notice', { event: 'wake' }), [])
  assert(v.check('notice', { event: 'boom' })[0].includes('one of'))
  assert(v.check('task', { domain: { nested: 1 } })[0].includes('scalar'))
})

Deno.test('JSON properties store validated JSON text', () => {
  let w = loadVocab({
    $defs: {
      config: {
        component: true,
        type: 'object',
        properties: { value: { type: 'string', format: 'json' } },
      },
    },
  })
  let c = w.prop('config', 'value')!
  assertEquals([c.category, c.scalar, c.affinity], ['scalar', 'json', 'text'])
  for (let value of [null, 'null', '{}', '[1, true]', '"text"', '0', 'false']) {
    assertEquals(w.check('config', { value }), [])
  }
  for (let value of ['', 'undefined', '{oops}', '[1,]', 'NaN', false, 42]) {
    assertEquals(w.check('config', { value }), ['config.value is JSON text'])
  }
  for (let value of [{ nested: 1 }, [1]]) {
    assert(w.check('config', { value })[0].includes('is a scalar'))
  }
})

Deno.test('object, array and union properties hold a JSON value', () => {
  let w = loadVocab({
    $defs: {
      recipe: {
        component: true,
        properties: {
          meta: { type: 'object', properties: { a: { type: 'number' } } },
          tags: { type: 'array', items: { type: 'string' } },
          any: { type: ['string', 'number', 'object'] },
        },
      },
    },
  })
  let c = w.prop('recipe', 'meta')!
  assertEquals(
    [c.category, c.scalar, c.affinity, c.types],
    ['scalar', 'jsonb', 'blob', ['object']],
  )
  assertEquals(w.prop('recipe', 'any')!.types, ['string', 'number', 'object'])
  let ok = { meta: { a: 1 }, tags: ['x'], any: 'text' }
  assertEquals(w.check('recipe', ok), [])
  assertEquals(w.check('recipe', { any: 2.5 }), [])
  assertEquals(w.check('recipe', { meta: [1], tags: {}, any: true }), [
    'recipe.meta is an object',
    'recipe.tags is an array',
    'recipe.any is a string or a number or an object',
  ])
})

Deno.test('a property with no type is refused, never read as text', () => {
  let load = (s: PropSchema) =>
    loadVocab({ $defs: { x: { component: true, properties: { c: s } } } })
  for (let s of [{}, { enum: ['a'] }, { format: 'date-time' }]) {
    assertThrows(() => load(s), Error, 'x.c declares no type')
  }
})

Deno.test('a string property casts what it is sent to a string', () => {
  let w = loadVocab({
    $defs: {
      note: {
        component: true,
        properties: {
          text: { type: 'string' },
          state: { type: 'string', enum: ['1', 'true'] },
          raw: { type: 'string', format: 'json' },
          n: { type: 'number' },
          meta: { type: 'object' },
          about: { type: 'string', ref: 'entity', death: 'keep' },
        },
      },
    },
  })
  assertEquals(
    cast(w, 'note', {
      text: 5,
      state: true,
      raw: { a: [1] },
      n: 5,
      meta: { a: 1 },
      about: 7,
    }),
    {
      text: '5',
      state: 'true',
      raw: '{"a":[1]}',
      n: 5,
      meta: { a: 1 },
      about: 7,
    },
  )
  assertEquals(cast(w, 'note', { text: null }), { text: null })
})

Deno.test('number and priority properties refuse non-finite values', () => {
  for (let format of [undefined, 'priority']) {
    let w = loadVocab({
      $defs: {
        reading: {
          component: true,
          properties: { value: { type: 'number', format } },
        },
      },
    })
    for (let value of [NaN, Infinity, -Infinity]) {
      assertEquals(w.check('reading', { value }), ['reading.value is a number'])
    }
    for (let value of [null, 0, -1, 1.5, Number.MAX_VALUE]) {
      assertEquals(w.check('reading', { value }), [])
    }
  }
})

Deno.test('a computed property reads but never writes', () => {
  let w = loadVocab({
    $defs: {
      task: {
        component: true,
        type: 'object',
        kind: true,
        properties: {
          priority: { type: 'number' },
          status: { type: 'string', enum: ['open', 'done'], computed: true },
        },
      },
    },
  })
  assertEquals(w.comp('task')?.writable, ['priority'])
  assertEquals(w.route('status'), { comp: 'task', prop: 'status' })
  assertEquals(w.prop('task', 'status')?.computed, true)
  assert(w.check('task', { status: 'open' }).length == 1)
})

Deno.test('an ambiguous word names its choices for whoever can decide', () => {
  let w = loadVocab({
    $defs: {
      task: { component: true, properties: { status: { type: 'string' } } },
      session: { component: true, properties: { status: { type: 'string' } } },
    },
  })
  let e = assertThrows(() => w.route('status'), Ambiguous)
  assertEquals((e as Ambiguous).prop, 'status')
  assertEquals((e as Ambiguous).comps, ['session', 'task'])
  assertEquals((e as Ambiguous).name, 'Ambiguous')
})

Deno.test('the order refuses cycles', () => {
  assertThrows(
    () => kindOrder(['a', 'b'], (k) => (k == 'a' ? ['b'] : ['a'])),
    Error,
    'cycle',
  )
})

Deno.test('a `before` naming an absent kind is no constraint', () => {
  // a document composes in any subset: an unloaded target just drops out
  assertEquals(kindOrder(['a'], () => ['ghost']), ['a'])
  assertEquals(kindOrder(['b', 'a'], (k) => (k == 'b' ? ['ghost'] : [])), [
    'a',
    'b',
  ])
  // but the same `before` binds once the target is present
  assertEquals(kindOrder(['a', 'b'], (k) => (k == 'b' ? ['a'] : [])), [
    'b',
    'a',
  ])
})

Deno.test('the fleet order is unchanged: memory and project precede doc', () => {
  // the `before: doc` constraints still bind when doc loads alongside them
  let at = (k: string) => v.kinds.indexOf(k)
  assert(at('memory') < at('doc'))
  assert(at('project') < at('doc'))
})

Deno.test('indexes merge the property flag with the composite lists', () => {
  let w = loadVocab({
    $defs: {
      space: {
        component: true,
        type: 'object',
        properties: { slug: { type: 'string', unique: true } },
      },
      app: {
        component: true,
        type: 'object',
        unique: [['space', 'slug']],
        index: [['space', 'version']],
        properties: {
          slug: { type: 'string' },
          space: { type: 'string', ref: 'entity', death: 'cascade' },
          version: { type: 'number' },
          hot: { type: 'boolean', index: true },
          // computed: no cell to index
          rank: { type: 'number', computed: true, index: true },
        },
      },
      alias: {
        component: true,
        type: 'object',
        properties: { slug: { type: 'string' } },
      },
    },
  })
  assertEquals(w.indexes('space'), [{ props: ['slug'], unique: true }])
  assertEquals(w.indexes('app'), [
    { props: ['hot'], unique: false },
    { props: ['space', 'slug'], unique: true },
    { props: ['space', 'version'], unique: false },
  ])
  assertEquals(w.indexes('alias'), [])
  assertEquals(w.indexes('nobody'), [])
})

Deno.test('one pair declared twice is one index, unique if either said so', () => {
  let w = loadVocab({
    $defs: {
      shelf: {
        component: true,
        type: 'object',
        unique: [['aisle']],
        index: [['aisle']],
        properties: { aisle: { type: 'string', index: true } },
      },
    },
  })
  assertEquals(w.indexes('shelf'), [{ props: ['aisle'], unique: true }])
})

Deno.test('a word has one home across documents', () => {
  assertThrows(
    () =>
      loadVocab([slice, {
        $defs: {
          doc: {
            component: true,
            type: 'object',
          },
        },
      }]),
    Error,
    'declared twice',
  )
})

// The spine's case: a plugin keeps a property beside every entity without
// declaring a second `entity`.
let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { archetype: { type: 'string', stamped: true } },
    },
  },
}
let adds = (
  properties: Record<string, PropSchema>,
  more: PropSchema = {},
): VocabDoc => ({
  $defs: { entity: { component: true, extends: true, properties, ...more } },
})

Deno.test('an extension adds its properties to the component another document declares', () => {
  let v = loadVocab([spine, adds({ num: { type: 'number', stamped: true } })])
  assertEquals(v.props('entity'), ['archetype', 'num'])
  assertEquals(v.comp('entity')!.wire, false)
  assertEquals(v.prop('entity', 'num')!.stamped, true)
  // And the order the documents arrive in decides nothing.
  assertEquals(
    loadVocab([adds({ num: { type: 'number' } }), spine]).props('entity'),
    ['archetype', 'num'],
  )
})

Deno.test('an extension of a component nobody declares is refused', () => {
  assertThrows(
    () => loadVocab([adds({ num: { type: 'number' } })]),
    Error,
    'extends a component no document declares',
  )
})

Deno.test('an extension may not redeclare a property or restate the component', () => {
  assertThrows(
    () => loadVocab([spine, adds({ archetype: { type: 'string' } })]),
    Error,
    "already declares a 'archetype' property",
  )
  assertThrows(
    () => loadVocab([spine, adds({ num: { type: 'number' } }, { kind: true })]),
    Error,
    'may only add properties',
  )
})

Deno.test('every stored reference is indexed without an opt-in', () => {
  let ref = { type: 'string', ref: 'entity', death: 'keep' }
  let w = loadVocab({
    $defs: {
      link: {
        component: true,
        type: 'object',
        wire: false,
        properties: {
          target: ref,
          by: { ...ref, stamped: true },
          explicit: { ...ref, index: true },
          off: { ...ref, index: false },
          unique: { ...ref, unique: true },
          computed: { ...ref, computed: true },
          scalar: { type: 'string' },
        },
      },
    },
  })
  assertEquals(w.indexes('link'), [
    { props: ['explicit'], unique: false },
    { props: ['unique'], unique: true },
    { props: ['target'], unique: false },
    { props: ['by'], unique: false },
    { props: ['off'], unique: false },
  ])
})

Deno.test('only the leading reference is covered by a composite index', () => {
  for (
    let declaration of [
      { index: [['from', 'to']] },
      { unique: [['from', 'to']] },
      { identity: ['from', 'to'] },
    ]
  ) {
    let ref = { type: 'string', ref: 'entity', death: 'cascade' }
    let w = loadVocab({
      $defs: {
        link: {
          component: true,
          type: 'object',
          ...declaration,
          properties: { from: ref, to: ref },
        },
      },
    })
    assertEquals(w.indexes('link'), [
      { props: ['from', 'to'], unique: !('index' in declaration) },
      { props: ['to'], unique: false },
    ])
  }
})

Deno.test('native constraints interrogate: integer, required, default', () => {
  let w = loadVocab({
    $defs: {
      created: {
        component: true,
        type: 'object',
        required: ['at'],
        properties: {
          at: { type: 'string', format: 'date-time', default: { now: true } },
          by: { type: 'string', ref: 'entity', death: 'keep' },
        },
      },
      repo: {
        component: true,
        type: 'object',
        required: ['base'],
        properties: {
          base: { type: 'string', default: 'main' },
          push: { type: 'boolean', default: false },
          seq: { type: 'integer' },
          score: { type: 'number' },
        },
      },
    },
  })
  let at = w.prop('created', 'at')!
  assertEquals([at.required, at.default, at.scalar], [
    true,
    { now: true },
    'time',
  ])
  assertEquals(w.prop('created', 'by')!.required, false)
  assertEquals(w.prop('repo', 'base')!.default, { value: 'main' })
  assertEquals(w.prop('repo', 'push')!.default, { value: false })
  // `integer` is native JSON Schema saying the value has no fraction, and the
  // store keeps it that way; a plain number stores as real.
  assertEquals(w.prop('repo', 'seq')!.affinity, 'integer')
  assertEquals(w.prop('repo', 'score')!.affinity, 'real')
  assertEquals(w.prop('repo', 'seq')!.default, undefined)
})

Deno.test('a composite entry may be partial: the properties a row must hold', () => {
  let w = loadVocab({
    $defs: {
      output: {
        component: true,
        type: 'object',
        unique: [{ props: ['key'], present: ['key'] }],
        index: [['source']],
        properties: {
          key: { type: 'string' },
          source: { type: 'integer' },
        },
      },
    },
  })
  assertEquals(w.indexes('output'), [
    { props: ['key'], unique: true, present: ['key'] },
    { props: ['source'], unique: false },
  ])
})

Deno.test('a property says for itself whether its words are searched', () => {
  let w = loadVocab({
    $defs: {
      recipe: {
        component: true,
        type: 'object',
        properties: {
          note: { type: 'string', search: true },
          origin: { type: 'string' },
        },
      },
    },
  })
  assertEquals(w.prop('recipe', 'note')!.search, true)
  assertEquals(w.prop('recipe', 'origin')!.search, false)
})
