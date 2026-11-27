// A vocabulary through its bundles and back, alone and through a graph over
// @yaks/ram: what loads from the bundles is what loaded from the documents,
// and the queries that describe a vocabulary answer from its entities.

import { line, whole } from '@yaks/query'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Bundle, graph } from '@yaks/graph'
import { derivedEid, mint } from '@yaks/graph/identity'
import { ram } from '@yaks/ram'
import {
  effectsIn,
  fromBundles,
  type Keywords,
  labelled,
  loadVocab,
  metaDoc,
  rowsOf,
  saveOf,
  toBundles,
  type VocabDoc,
} from './mod.ts'
import { facts } from './testing.ts'

// Two packages: a kitchen declaring recipes, and a tagger adding a property to
// them and a component found by a recipe's text.
let kitchen: VocabDoc = {
  label: '@t/kitchen',
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
    menu: { component: true, type: 'object' },
    recipe_shop: {
      effect: true,
      created: ['recipe'],
      changed: ['recipe.serves'],
      target: '.recipe !note',
      tries: 3,
      sweep: '.recipe',
      description: 'buy what a recipe needs',
    },
  },
  kinds: {
    meal: {
      title: 'A meal',
      description: 'recipes served together',
      is: ['recipe', 'menu'],
      with: { doc: true, note: { text: 'enjoy' } },
      before: ['note'],
      prefix: 'M',
      examples: [{
        recipe: { slug: 'soup' },
        menu: {},
        doc: { title: 'Lunch' },
      }],
    },
  },
}

let tagger: VocabDoc = {
  label: '@t/tags',
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

// Rows where their labels derive as the plain sentence, for bundles that never
// meet a graph.
let plain = (s: string) => s
type Derive = typeof plain

let load = (docs: VocabDoc[]) => loadVocab(docs, words)
// Each document's rows, a name it says of another's found in the vocabulary
// they load as together, as a host reads them.
let bundlesOf = (docs: VocabDoc[], derive: Derive, vocab = load(docs)) =>
  docs.flatMap((d) => toBundles(d, derive, vocab))

test('a vocabulary loads back from its bundles as it was', () => {
  let docs = [kitchen, tagger, docDoc]
  let back = fromBundles(bundlesOf(docs, plain))
  assertEquals(facts(load(back)), facts(load(docs)))
  assertEquals(effectsIn(back), effectsIn(docs))
  assertEquals(back[0].$defs?.recipe_shop.sweep, '.recipe')
})

test('a kind of its own component’s name is said on that component', () => {
  let doc: VocabDoc = {
    label: '@t/menus',
    $defs: { menu: { component: true } },
    kinds: { menu: { prefix: 'M' } },
  }
  let [back] = fromBundles(toBundles(doc, plain))
  assertEquals(back.kinds, undefined)
  assertEquals(back.$defs!.menu.prefix, 'M')
  assertEquals(load([back]).kind('menu'), load([doc]).kind('menu'))
})

test('a saved peer-relayed declaration survives a vocabulary bundle roundtrip', () => {
  let doc: VocabDoc = {
    $defs: {
      position: {
        component: true,
        sync: 'peers',
        durable: 'forever',
        pace: '100ms',
        save: '!position | .updated.at<="30s ago"',
        properties: { x: { type: 'number' } },
      },
    },
  }
  let back = load(fromBundles(toBundles(doc, plain)))
  assertEquals(facts(back), facts(load([doc])))
  assertEquals(
    back.def('position')?.save,
    '!position | .updated.at<="30s ago"',
  )
  assertEquals(saveOf(back, 'position'), '!position | .updated.at<="30s ago"')
})

test('the rungs another package adds to a status ladder survive', () => {
  let chores: VocabDoc = {
    label: '@t/chores',
    $defs: {
      chore: { component: true, status: { finished: 'done', default: 'open' } },
      finished: { component: true },
    },
  }
  let helpers: VocabDoc = {
    label: '@t/helpers',
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

// A vocabulary whose words carry identities, and a document extending one of
// them: by its `$id`, or by its label alone.
let urn = () => `urn:uuid:${mint()}`
let ided = (): VocabDoc => ({
  $id: urn(),
  label: '@t/pantry',
  $defs: {
    jar: {
      $id: urn(),
      component: true,
      kind: true,
      before: ['shelf'],
      properties: { label: { $id: urn(), type: 'string' } },
    },
    shelf: { $id: urn(), component: true },
    jar_count: { $id: urn(), effect: true, created: ['jar'] },
  },
  kinds: { shelf: { $id: urn(), is: ['shelf'] } },
})
let id = (s?: string) => s!.slice('urn:uuid:'.length)

test('each row is its word’s $id, and the words read back with them', () => {
  let pantry = ided()
  let lids: VocabDoc = {
    $id: urn(),
    label: '@t/lids',
    $defs: {
      jar: {
        $id: pantry.$defs!.jar.$id,
        component: true,
        extends: true,
        properties: { lid: { $id: urn(), type: 'boolean' } },
      },
    },
  }
  let rows = bundlesOf([pantry, lids], plain)
  let at = (comp: string, name: string) =>
    rows.find((b) => (b[comp] as { name?: string })?.name == name)!
  let { jar } = pantry.$defs!
  assertEquals(at('_namespace', '@t/pantry').entity.eid, id(pantry.$id))
  assertEquals(at('_comp', 'jar').entity.eid, id(jar.$id))
  assertEquals(at('_prop', 'label').entity.eid, id(jar.properties!.label.$id))
  let lid = at('_prop', 'lid')._prop as Record<string, unknown>
  assertEquals([lid.comp, lid.namespace], [id(jar.$id), id(lids.$id)])
  assertEquals(at('_kind', 'shelf').entity.eid, id(pantry.kinds!.shelf.$id))
  assertEquals(
    at('_effect', 'jar_count').entity.eid,
    id(pantry.$defs!.jar_count.$id),
  )
  // A component's own kind is its word, so its row derives from its identity.
  assertEquals(at('_kind', 'jar').entity.eid, `_kind|${id(jar.$id)}`)
  let [edge] = rows.filter((b) => b._before)
  assertEquals(edge.edge, {
    from: `_kind|${id(jar.$id)}`,
    to: id(pantry.kinds!.shelf.$id),
    ord: 0,
  })
  let back = fromBundles(rows)
  assertEquals(back.map((d) => d.$id), [pantry.$id, lids.$id])
  assertEquals(facts(load(back)), facts(load([pantry, lids])))
})

test('a renamed word keeps its rows', () => {
  let pantry = ided()
  let { jar, ...rest } = pantry.$defs!
  let { label, ...props } = jar.properties!
  let renamed: VocabDoc = {
    ...pantry,
    $defs: {
      ...rest,
      pot: { ...jar, properties: { ...props, name: label } },
    },
  }
  let eids = (doc: VocabDoc) =>
    toBundles(doc, plain).filter((b) => !b._kind).map((b) => b.entity.eid)
  assertEquals(eids(renamed).sort(), eids(pantry).sort())
})

test('an extension without the $id finds its component by label', () => {
  let pantry = ided()
  let lids: VocabDoc = {
    label: '@t/lids',
    $defs: {
      jar: {
        component: true,
        extends: true,
        properties: { lid: { type: 'boolean' } },
      },
    },
  }
  let vocab = load([pantry, lids])
  let [, ext] = toBundles(lids, plain, vocab)
  assertEquals(
    (ext._extends as { comp: string }).comp,
    id(pantry.$defs!.jar.$id),
  )
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
  let id = labelled(derivedEid)
  let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
  let put = (docs: VocabDoc[]) =>
    g.apply(bundlesOf(docs, derivedEid) as Bundle[], { trusted: true })
  let titles = async (q: string) =>
    (await g.read(whole(`${q} ?doc`))).map((b) =>
      (b.doc as { title: string }).title
    )
  return { g, id, put, titles }
}

test('the queries that describe a vocabulary answer from its entities', async () => {
  let { g, id, put, titles } = described()
  let meta = { ...metaDoc, label: '@yaks/vocab' }
  await put([kitchen, tagger, meta, docDoc])
  // The index: every component, a readable name each.
  assertEquals((await titles('._comp')).sort(), [
    '_before',
    '_comp',
    '_effect',
    '_extends',
    '_kind',
    '_namespace',
    '_prop',
    '_vocab',
    'doc',
    'menu',
    'note',
    'recipe',
    'tag',
  ])
  // Every kind, and what makes one.
  assertEquals(
    (await titles('._kind.namespace._namespace.name=@t/kitchen')).sort(),
    ['A meal', 'note', 'recipe'],
  )
  let [meal] = await g.read('._kind.name=meal ?doc')
  assertEquals(meal._kind, {
    name: 'meal',
    namespace: id.namespace('@t/kitchen'),
    is: ['recipe', 'menu'],
    with: { doc: true, note: { text: 'enjoy' } },
    prefix: 'M',
    examples: kitchen.kinds!.meal.examples,
  })
  assertEquals((meal.doc as { body: string }).body, 'recipes served together')
  // One component's properties, following the reference to its name, in the
  // order its package declares them; another package's come after.
  assertEquals(
    await titles(
      '._prop.comp._comp.name=recipe ._prop.namespace._namespace.name=@t/kitchen ' +
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
    await titles('._prop.namespace._namespace.name=@t/tags'),
    ['recipe.tagged'],
  )
  assertEquals(await titles('._prop.ref=note'), ['recipe.book'])
  let before = await g.read(
    line`._before .edge.from=${id.kind('recipe')} .order=edge.ord`,
  )
  let at = rowsOf(load([kitchen, tagger, meta, docDoc]), derivedEid)
  assertEquals(
    before.map((b) => (b.edge as { to: string }).to),
    [at.kind('note'), at.kind('doc')],
  )
  // The effects a package declares, and what owes each a run.
  let [shop] = await g.read('._effect.namespace._namespace.name=@t/kitchen')
  assertEquals(shop._effect, {
    name: 'recipe_shop',
    namespace: id.namespace('@t/kitchen'),
    created: ['recipe'],
    changed: ['recipe.serves'],
    target: '.recipe !note',
    tries: 3,
    keywords: { sweep: '.recipe' },
  })
  // A word is found in a description: the component's, and its kind's.
  assertEquals(await titles('dish'), ['recipe', 'recipe'])
  // And what the graph holds is the vocabulary it was given.
  // Each package, described.
  let [pkg] = await g.read('._namespace.name=@t/kitchen ?doc')
  assertEquals((pkg.doc as { body: string }).body, 'recipes and notes')
  let rows = [
    ...await g.read('._namespace'),
    ...await g.read('._comp ?doc'),
    ...await g.read('._kind ?doc'),
    ...await g.read('._effect ?doc'),
    ...await g.read('._extends ?doc'),
    ...await g.read('._prop ?doc'),
    ...await g.read('._before ?edge'),
  ]
  let docs = [kitchen, tagger, meta, docDoc]
  assertEquals(facts(load(fromBundles(rows))), facts(load(docs)))
  assertEquals(effectsIn(fromBundles(rows)), effectsIn(docs))
})

test('a document read again states each row whole', async () => {
  let { g, put } = described()
  await put([kitchen])
  let { prefix: _, description: __, ...plainer } = kitchen.$defs!.recipe
  await put([{ ...kitchen, $defs: { ...kitchen.$defs, recipe: plainer } }])
  let [recipe] = await g.read('._comp.name=recipe ?doc')
  assert(!(recipe.doc as { body?: string }).body)
  let [kind] = await g.read('._kind.name=recipe ?doc')
  assert(!(kind._kind as { prefix?: string }).prefix)
  assert(!(kind.doc as { body?: string }).body)
})
