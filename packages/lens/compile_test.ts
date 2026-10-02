import { equal, ok, test, throws } from '@yaks/testing'
import {
  and,
  contains,
  fields,
  or,
  order,
  parse,
  present,
  want,
} from '@yaks/query'
import { type Bundle, derivedEid } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { compile } from './compile.ts'
import { lensesIn, packageEid, versions } from './described.ts'
import { docs } from './vocab.ts'

let doc = {
  package: 'kitchen',
  $defs: {
    title: {
      lens: true,
      step: 0,
      ops: [{ rename: { from: 'recipe.title', to: 'doc.title' } }],
    },
  },
}
let rows = lensesIn([doc]), pkg = packageEid('kitchen')
let lens = compile(rows)
let b = (comps: Omit<Bundle, 'entity'>): Bundle => ({
  entity: { eid: 'cake' },
  ...comps,
})

test('a rename consumes only the property written, keeps its aspect, and translates a guard', () => {
  let before = b({
    recipe: { title: 'Cake', yield: 4 },
    doc: { body: 'mix' },
    $was: { recipe: { title: 'hash' } },
  })
  equal(
    lens.put(before),
    b({
      recipe: { yield: 4 },
      doc: { title: 'Cake', body: 'mix' },
      $was: { recipe: {}, doc: { title: 'hash' } },
    }),
  )
  equal(before.recipe, { title: 'Cake', yield: 4 })
  equal(
    lens.put(b({ recipe: { title: 'Cake' } })),
    b({ recipe: {}, doc: { title: 'Cake' } }),
  )
  let omitted = b({ recipe: { yield: 3 } })
  ok(lens.put(omitted) === omitted)
  equal(
    lens.put(b({ recipe: { title: null } })),
    b({ recipe: {}, doc: { title: null } }),
  )
  equal(
    lens.put(b({ recipe: null })),
    b({ recipe: null, doc: { title: null } }),
  )
})

test('overlapping writes and guards refuse rather than silently lose either value', async () => {
  for (let target of [{ title: 'Other' }, null]) {
    await throws(() => lens.put(b({ recipe: { title: 'Cake' }, doc: target })))
  }
  await throws(() =>
    lens.put(b({ $was: { recipe: { title: 'one' }, doc: { title: 'two' } } }))
  )
  equal(
    lens.put(b({ recipe: { title: 'Cake' }, doc: { title: 'Cake' } })),
    b({ recipe: {}, doc: { title: 'Cake' } }),
  )
})

test('old reads copy the existing target, without inventing the moved-from aspect', () => {
  equal(
    lens.get(b({ recipe: {}, doc: { title: 'Cake', body: 'mix' } })),
    b({ recipe: { title: 'Cake' }, doc: { title: 'Cake', body: 'mix' } }),
  )
  let document = b({ doc: { title: 'Note' } })
  ok(lens.get(document) === document)
  equal(
    lens.get(b({ recipe: {}, doc: { title: null } })),
    b({ recipe: { title: null }, doc: { title: null } }),
  )
})

test('old feed patches use held membership and translate target removals without copying held fields', () => {
  let patch = b({ doc: { title: 'Fresh' } })
  let held = b({
    recipe: { title: 'Old', yield: 4 },
    doc: { title: 'Old', body: 'mix' },
  })
  ok(lens.get(patch) === patch)
  equal(
    lens.get(patch, held),
    b({ recipe: { title: 'Fresh' }, doc: { title: 'Fresh' } }),
  )
  ok(lens.get(patch, b({ doc: { title: 'Old' } })) === patch)
  equal(
    lens.get(b({ doc: null }), held),
    b({ recipe: { title: null }, doc: null }),
  )
  equal(
    lens.get(b({ recipe: {}, doc: null })),
    b({ recipe: { title: null }, doc: null }),
  )
  let removed = b({ recipe: null, doc: { title: 'Fresh' } })
  ok(lens.get(removed, held) === removed)
  let bothRemoved = b({ recipe: null, doc: null })
  ok(lens.get(bothRemoved, held) === bothRemoved)
  let omitted = b({ doc: { body: 'new body' } })
  ok(lens.get(omitted, held) === omitted)
  equal(
    held,
    b({
      recipe: { title: 'Old', yield: 4 },
      doc: { title: 'Old', body: 'mix' },
    }),
  )
})

test('queries preserve branch membership, directives and component projections', () => {
  equal(
    lens.ask(parse('.recipe.title~=cake')),
    and(and(present('recipe'), contains('doc.title', 'cake')), want('recipe')),
  )
  equal(
    lens.ask(and(or(contains('recipe.title', 'cake'), present('note')))),
    and(
      or(
        and(present('recipe'), contains('doc.title', 'cake')),
        present('note'),
      ),
      want('recipe'),
    ),
  )
  equal(lens.ask(and(present('recipe'))), and(present('recipe'), want('doc')))
  equal(
    lens.ask(and(fields('recipe.title~'), order('-recipe.title'))),
    and(fields('doc.title~'), order('-doc.title'), want('recipe')),
  )
})

test('steps compose in order, and a current caller receives its exact inputs', () => {
  let second = {
    entity: { eid: 'next' },
    _lens: {
      package: pkg,
      step: 1,
      ops: [{ rename: { from: 'doc.title', to: 'heading.text' } }],
    },
  }
  let chain = compile([...rows, second])
  equal(
    chain.put(b({ recipe: { title: 'Cake' } })),
    b({ recipe: {}, doc: {}, heading: { text: 'Cake' } }),
  )
  equal(
    chain.get(b({ recipe: {}, doc: {}, heading: { text: 'Cake' } })),
    b({
      recipe: { title: 'Cake' },
      doc: { title: 'Cake' },
      heading: { text: 'Cake' },
    }),
  )
  let current = compile(rows, { [pkg]: 1 }),
    bundle = b({ recipe: { title: 'leave as written' } }),
    query = parse('.recipe')
  ok(
    current.put(bundle) === bundle && current.get(bundle) === bundle &&
      current.ask(query) === query,
  )
  ok(compile(rows) === lens)
  ok(compile([]).put(bundle) === bundle)
})

test('inside-component renames remove only the replaced name in both directions', () => {
  let local = compile([{
    entity: { eid: 'same' },
    _lens: {
      package: 'p',
      step: 0,
      ops: [{ rename: { from: 'recipe.title', to: 'recipe.name' } }],
    },
  }])
  equal(
    local.put(b({ recipe: { title: null, yield: 1 } })),
    b({ recipe: { name: null, yield: 1 } }),
  )
  equal(
    local.get(b({ recipe: { name: 'Cake', yield: 1 } })),
    b({ recipe: { title: 'Cake', yield: 1 } }),
  )
})

test('authored steps pass vocabulary loading and derive the declared identities', async () => {
  let vocab = loadVocab([...docs, doc])
  ok(vocab.comp('_lens'))
  equal(rows[0].entity.eid, derivedEid(`_lens|${pkg}|0`))
  equal(versions([doc]), { [pkg]: 1 })
  equal(versions([{ package: 'kitchen' }]), { [pkg]: 0 })
  await throws(() => lensesIn([{ $defs: doc.$defs }]))
  await throws(() =>
    compile([{ ...rows[0], _lens: { ...(rows[0]._lens as object), step: 2 } }])
  )
  await throws(() => compile(rows, { [pkg]: 2 }))
  await throws(() =>
    compile([{
      ...rows[0],
      _lens: {
        package: pkg,
        step: 0,
        ops: [{ rename: { from: 'title', to: 'doc.title' } }],
      },
    }])
  )
})
