import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, detached, graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { metaDoc } from '@yaks/vocab'
import { docs } from './vocab.ts'
import { lenses } from './plugin.ts'
import { described, lensesIn, packageEid } from './described.ts'
import { compile } from './compile.ts'

let kitchen = {
  package: 'kitchen',
  $defs: {
    recipe: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, yield: { type: 'integer' } },
    },
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    rename: {
      lens: true,
      step: 0,
      ops: [{ rename: { from: 'recipe.title', to: 'doc.title' } }],
    },
  },
}
let pkg = packageEid('kitchen'), speaks = { [pkg]: 0 }
let setup = (report?: (error: unknown) => void) => {
  let vocab = loadVocab([metaDoc, ...docs, kitchen])
  let g = graph({ vocab, storage: ram(vocab), plugins: [lenses(report)] })
  let out = g.apply([
    { entity: { eid: pkg }, _package: { name: 'kitchen' } },
    ...lensesIn([kitchen]),
  ], { trusted: true })
  ok(!(out instanceof Promise))
  return g
}

test('an unversioned caller needs no metadata read and keeps its exact values', () => {
  let vocab = loadVocab([metaDoc, ...docs, kitchen])
  let storage = ram(vocab)
  storage.read = () => {
    throw new Error('unexpected metadata read')
  }
  let tx = detached(storage), plugin = lenses()
  let rows = [{ entity: { eid: 'cake' }, recipe: { title: 'Cake' } }]
  let query = compile([]).find()
  ok(plugin.hooks!.normalize!(rows, tx) === rows)
  ok(plugin.ask!({ opts: {}, tx }, query) === query)
  ok(plugin.answer!({ opts: {}, tx }, rows) === rows)
})

test('old graph writes, filtered reads and get projections pass through rename hooks synchronously', () => {
  let g = setup()
  let out = g.apply([{
    entity: { eid: 'cake' },
    recipe: { title: 'Cake', yield: 2 },
    $speaks: speaks,
  }])
  ok(!(out instanceof Promise))
  let current = g.get(['cake']) as Bundle[]
  equal(current[0].recipe, { yield: 2 })
  equal(current[0].doc, { title: 'Cake' })
  let old = g.read('.recipe.title~=cake', { speaks }) as Bundle[]
  equal(old.map((b) => b.entity.eid), ['cake'])
  equal(old[0].recipe, { yield: 2, title: 'Cake' })
  equal((g.get(['cake'], ['recipe'], { speaks }) as Bundle[])[0].recipe, {
    yield: 2,
    title: 'Cake',
  })
  equal((g.read('.recipe', { speaks }) as Bundle[])[0].recipe, {
    yield: 2,
    title: 'Cake',
  })
  g.apply([{ entity: { eid: 'plain' }, doc: { title: 'Cake note' } }])
  equal(
    (g.read('.recipe.title~=cake', { speaks }) as Bundle[]).map((b) =>
      b.entity.eid
    ),
    ['cake'],
  )
})

test('a failed translation writes none of the batch and strips no caller input', async () => {
  let reported: unknown[] = []
  let g = setup((error) => reported.push(error))
  let patch = {
    entity: { eid: 'conflict' },
    recipe: { title: 'One' },
    doc: { title: 'Two' },
    $speaks: speaks,
  }
  await throws(
    () =>
      g.apply([
        { entity: { eid: 'first' }, recipe: {}, $speaks: speaks },
        patch,
      ]),
    'conflicting writes',
  )
  equal(g.get(['first', 'conflict']), [])
  equal(patch.recipe, { title: 'One' })
  equal(patch.$speaks, speaks)
  equal(reported.length, 1)
  ok(reported[0] instanceof Error)
  let error = await throws(() => g.apply([patch]))
  ok(error instanceof Refused)
})

test('patch answers use stored aspect membership without copying stored fields', () => {
  let g = setup()
  g.apply([
    { entity: { eid: 'cake' }, recipe: { yield: 4 }, doc: { title: 'Cake' } },
    { entity: { eid: 'note' }, doc: { title: 'Note' } },
  ])
  let rows = [
    { entity: { eid: 'cake' }, doc: { title: 'New cake' } },
    { entity: { eid: 'note' }, doc: { title: 'New note' } },
  ]
  equal(
    lenses().answer!(
      { opts: { speaks, patch: true }, tx: detached(g.storage) },
      rows,
    ),
    [
      {
        entity: { eid: 'cake' },
        doc: { title: 'New cake' },
        recipe: { title: 'New cake' },
      },
      rows[1],
    ],
  )
  equal(
    lenses().answer!(
      { opts: { speaks, patch: true }, tx: detached(g.storage) },
      [
        { entity: { eid: 'cake' }, doc: null },
      ],
    ),
    [
      { entity: { eid: 'cake' }, doc: null, recipe: { title: null } },
    ],
  )
})

test('metadata fills once and never silently changes an existing step', async () => {
  let g = setup()
  equal(await described(g, [kitchen]), [])
  let changed = {
    ...kitchen,
    $defs: {
      ...kitchen.$defs,
      rename: {
        ...kitchen.$defs.rename,
        ops: [{ rename: { from: 'recipe.yield', to: 'doc.title' } }],
      },
    },
  }
  await throws(() => described(g, [changed]), 'immutable step')
})

test('find and put move seeded rows once through an expanded vocabulary', () => {
  let g = setup()
  g.apply([{ entity: { eid: 'seed' }, recipe: { title: 'Seed cake' } }])
  let lens = compile(lensesIn([kitchen]))
  let move = () => {
    let rows = g.read(lens.find()) as Bundle[]
    if (rows.length) {
      g.apply(rows.map((row) => {
        let patch = lens.put(row)
        return {
          ...patch,
          recipe: { ...(patch.recipe as object), title: null },
        }
      }))
    }
    return rows.length
  }
  equal(move(), 1)
  equal(move(), 0)
  let row = (g.read('.recipe.title~=cake', { speaks }) as Bundle[])[0]
  equal(row.recipe, { title: 'Seed cake' })
  equal(row.doc, { title: 'Seed cake' })
})

test('landed timestamp steps are immutable and new steps must follow the retained history', async () => {
  let early = 20261003140000, late = 20261004102000
  let declaration = (step: number, to = 'doc.title') => ({
    ...kitchen,
    $defs: {
      ...kitchen.$defs,
      rename: {
        lens: true,
        step,
        ops: [{ rename: { from: 'recipe.title', to } }],
      },
    },
  })
  let g = setup()
  g.apply(await described(g, [declaration(late)]), { trusted: true })
  equal(await described(g, [declaration(late)]), [])
  await throws(
    () => described(g, [declaration(late, 'doc.body')]),
    'immutable step',
  )
  await throws(
    () => described(g, [declaration(early)]),
    'must follow landed step',
  )
  equal((await described(g, [declaration(20261005102000)])).length, 1)
})
