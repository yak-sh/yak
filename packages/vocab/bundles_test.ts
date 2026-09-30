// A vocabulary through its bundles and back, alone and through a graph over
// @yaks/ram: what loads from the bundles is what loaded from the documents,
// and the queries that describe a vocabulary answer from its entities.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Bundle, graph, identities } from '@yaks/graph'
import { ram } from '@yaks/ram'
import {
  fromBundles,
  type Ids,
  type Keywords,
  loadVocab,
  metaDoc,
  toBundles,
  type VocabDoc,
} from './mod.ts'
import { facts } from './testing.ts'

// Two packages: a kitchen declaring recipes, and a tagger adding a property to
// them and a component found by a recipe's text.
let kitchen: VocabDoc = {
  package: '@t/kitchen',
  description: 'recipes and notes',
  $defs: {
    recipe: {
      component: true,
      type: 'object',
      kind: true,
      before: ['note', 'doc'],
      prefix: 'R',
      identity: ['book', 'slug'],
      unique: [['book', 'title']],
      durable: 'forever',
      description: 'a dish and how to make it',
      required: ['slug'],
      properties: {
        slug: { type: 'string', minLength: 1, description: 'its address' },
        book: { type: 'string', ref: 'note', death: 'cascade' },
        title: { type: 'string', search: true },
        serves: { type: ['number', 'string'] },
        at: {
          type: 'string',
          format: 'date-time',
          default: { now: true },
          stamped: true,
        },
        diet: {
          type: 'string',
          enum: ['vegan', 'any'],
          aliases: { plant: 'vegan' },
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { n: { type: 'number' } },
            required: ['n'],
          },
        },
        rank: { type: 'number', computed: true, reads: [] },
      },
    },
    note: {
      component: true,
      type: 'object',
      kind: true,
      properties: { text: { type: 'string', store: 'blob' } },
    },
    recipe_list: { tool: true, noun: 'recipe', verb: 'list', input: {} },
  },
}

let tagger: VocabDoc = {
  package: '@t/tags',
  $defs: {
    recipe: {
      component: true,
      extends: true,
      required: ['tagged'],
      properties: { tagged: { type: 'boolean' } },
    },
    tag: { component: true, type: 'object', search: ['note.text'] },
  },
}

let words: Keywords[] = [
  { uri: 'https://example.com/t', comp: ['prefix'], prop: ['store'] },
]

// Ids as plain strings, for bundles that never meet a graph.
let plain: Ids = (comp, v) => `${comp}:${Object.values(v).join('.')}`

let load = (docs: VocabDoc[]) => loadVocab(docs, words)
let bundlesOf = (docs: VocabDoc[], id: Ids) =>
  docs.flatMap((d) => toBundles(d, id))

test('a vocabulary loads back from its bundles as it was', () => {
  let docs = [kitchen, tagger, docDoc]
  assertEquals(
    facts(load(fromBundles(bundlesOf(docs, plain)))),
    facts(load(docs)),
  )
})

test('the rungs another package adds to a status ladder survive', () => {
  let chores: VocabDoc = {
    package: '@t/chores',
    $defs: {
      chore: { component: true, status: { finished: 'done', default: 'open' } },
      finished: { component: true },
    },
  }
  let helpers: VocabDoc = {
    package: '@t/helpers',
    $defs: {
      chore: { component: true, extends: true, status: { held: 'wip' } },
      held: { component: true },
    },
  }
  let back = load(fromBundles(bundlesOf([chores, helpers], plain)))
  assertEquals(back.comp('chore')?.ladder?.rungs.map((r) => r.status), [
    'done',
    'wip',
  ])
})

test('a union type, the declared order and every keyword survive', () => {
  let back = load(fromBundles(bundlesOf([kitchen, tagger, docDoc], plain)))
  assertEquals(back.prop('recipe', 'serves')?.types, ['number', 'string'])
  assertEquals(back.props('recipe'), [
    'slug',
    'book',
    'title',
    'serves',
    'at',
    'diet',
    'steps',
    'rank',
    'tagged',
  ])
  assertEquals(back.comp('recipe')?.keywords, { prefix: 'R' })
  assertEquals(back.comp('recipe')?.before, ['note', 'doc'])
  assertEquals(back.def('recipe')?.properties?.slug.minLength, 1)
})

// The graph a front end keeps a vocabulary in: the meta vocabulary beside the
// `doc` and `edge` its rows wear.
let described = () => {
  let vocab = loadVocab([
    {
      $defs: {
        entity: {
          component: true,
          type: 'object',
          wire: false,
          properties: { num: { type: 'number', stamped: true } },
        },
      },
    },
    docDoc,
    edgeDoc,
    metaDoc,
  ], [edgeKeywords])
  let derive = identities(vocab)
  let id: Ids = (comp, v) => derive[comp](v, { entity: { eid: '' } })
  let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
  let put = (docs: VocabDoc[]) =>
    g.apply(bundlesOf(docs, id) as Bundle[], { trusted: true })
  let titles = async (q: string) =>
    (await g.read(`${q} ?doc`)).map((b) => (b.doc as { title: string }).title)
  return { g, id, put, titles }
}

test('the queries that describe a vocabulary answer from its entities', async () => {
  let { g, id, put, titles } = described()
  let meta = { ...metaDoc, package: '@yaks/vocab' }
  await put([kitchen, tagger, meta, docDoc])
  // The index: every component, a readable name each.
  assertEquals((await titles('._comp')).sort(), [
    '_before',
    '_comp',
    '_extends',
    '_package',
    '_prop',
    '_vocab',
    'doc',
    'note',
    'recipe',
    'tag',
  ])
  // One component's properties, following the reference to its name, in the
  // order its package declares them; another package's come after.
  assertEquals(
    await titles(
      '._prop.comp._comp.name=recipe ._prop.package._package.name=@t/kitchen ' +
        '.order=_prop.ord',
    ),
    [
      'recipe.slug',
      'recipe.book',
      'recipe.title',
      'recipe.serves',
      'recipe.at',
      'recipe.diet',
      'recipe.steps',
      'recipe.rank',
    ],
  )
  // What extends a component, what refers to it, and what it sorts before.
  assertEquals(
    await titles('._prop.package._package.name=@t/tags'),
    ['recipe.tagged'],
  )
  assertEquals(await titles('._prop.ref=note'), ['recipe.book'])
  let before = await g.read(
    `._before .edge.from=${id('_comp', { name: 'recipe' })} .order=edge.ord`,
  )
  assertEquals(
    before.map((b) => (b.edge as { to: string }).to),
    [id('_comp', { name: 'note' }), id('_comp', { name: 'doc' })],
  )
  // A word is found in a description.
  assertEquals(await titles('dish'), ['recipe'])
  // And what the graph holds is the vocabulary it was given.
  // Each package, described.
  let [pkg] = await g.read('._package.name=@t/kitchen ?doc')
  assertEquals((pkg.doc as { body: string }).body, 'recipes and notes')
  let rows = [
    ...await g.read('._package'),
    ...await g.read('._comp ?doc'),
    ...await g.read('._extends ?doc'),
    ...await g.read('._prop ?doc'),
    ...await g.read('._before ?edge'),
  ]
  assertEquals(
    facts(load(fromBundles(rows))),
    facts(load([kitchen, tagger, meta, docDoc])),
  )
})

test('a document read again states each row whole', async () => {
  let { g, put } = described()
  await put([kitchen])
  let { kind: _, description: __, ...plainer } = kitchen.$defs!.recipe
  await put([{ ...kitchen, $defs: { ...kitchen.$defs, recipe: plainer } }])
  let [recipe] = await g.read('._comp.name=recipe ?doc')
  assert(!(recipe._comp as { kind?: boolean }).kind)
  assert(!(recipe.doc as { body?: string }).body)
})
