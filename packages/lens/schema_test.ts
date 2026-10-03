import { equal, ok, test } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { compile, lensesIn, packageEid, versions } from './mod.ts'

let early = 20261003140000, late = 20261004102000
let app: VocabDoc = {
  package: 'kitchen',
  $defs: {
    recipe: { component: true, properties: { yield: { type: 'number' } } },
    first: {
      lens: true,
      step: early,
      ops: [{ rename: { from: 'recipe.title', to: 'recipe.heading' } }],
    },
    second: {
      lens: true,
      step: late,
      ops: [{ rename: { from: 'recipe.heading', to: 'doc.title' } }],
    },
  },
}
let docs: VocabDoc[] = [
  {
    $defs: {
      doc: { component: true, properties: { title: { type: 'string' } } },
    },
  },
  app,
]
let rows = lensesIn(docs)

test('old vocabulary follows the read inverse across package documents and timestamps', () => {
  let oldest = loadVocab(compile(rows).schema(docs))
  equal(oldest.comp('recipe')!.writable, ['yield', 'title'])
  equal(oldest.prop('recipe', 'title')!.scalar, 'text')
  equal(oldest.prop('doc', 'title')!.scalar, 'text')
  let middle = loadVocab(
    compile(rows, { [packageEid('kitchen')]: early }).schema(docs),
  )
  ok(middle.prop('recipe', 'heading'))
  ok(!middle.prop('recipe', 'title'))
  ok(compile(rows, versions(docs)).schema(docs) === docs)
  equal(docs[1].$defs!.recipe.properties, { yield: { type: 'number' } })
})

test('a within-component vocabulary rename carries required metadata without the replaced field', () => {
  let docs: VocabDoc[] = [{
    package: 'kitchen',
    $defs: {
      recipe: {
        properties: { heading: { type: 'string', description: 'A name' } },
        required: ['heading'],
      },
      first: app.$defs!.first,
    },
  }]
  let old = compile(lensesIn(docs)).schema(docs)
  equal(old[0].$defs!.recipe, {
    properties: { title: { type: 'string', description: 'A name' } },
    required: ['title'],
  })
  equal(docs[0].$defs!.recipe.required, ['heading'])
})

test('an inverse consumes a same-component destination declared by an extension', () => {
  let docs: VocabDoc[] = [{
    package: 'kitchen',
    $defs: {
      recipe: { component: true, properties: {} },
      first: app.$defs!.first,
    },
  }, {
    $defs: {
      recipe: {
        component: true,
        extends: true,
        properties: { heading: { type: 'string' } },
        required: ['heading'],
      },
    },
  }]
  let old = loadVocab(compile(lensesIn(docs)).schema(docs))
  ok(old.prop('recipe', 'title')?.required)
  ok(!old.prop('recipe', 'heading'))
})
