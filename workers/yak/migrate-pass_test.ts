import { equal, test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { insert } from '@yaks/sql'
import { objects as catalogue, storage } from '@yaks/sqlite'
import { preparedDriver, snapshot } from '../../packages/sqlite/testing.ts'
import { loadVocab } from '@yaks/vocab'
import { install, passed } from './migrate.ts'
import { fitSchema } from './store-schema.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'

let ONE = '10000000-0000-4000-8000-000000000001'
let TWO = '20000000-0000-4000-8000-000000000002'

// A wake's schema pass with the raising of the schema stood in for: what it
// is asked to raise, and what it leaves undone.
let pass = (left: Error[] = []) => {
  let asked = 0
  return {
    raise: () => (asked++, left),
    get asked() {
      return asked
    },
  }
}

// One file stands for every pass: a print is recorded for good, so each test
// names its own.
let file = preparedDriver(snapshot(loadVocab({})))
let shape = (print: string) => ({
  vocab: loadVocab({}),
  print,
  stamp: 'stamp',
})

let older = shape('older'), first = pass(), again = pass(), same = pass()
let firstStamp = passed(file, older, null, first.raise).stamp

test('a Store an older release opened is brought to its schema again, though its print is recorded', () => {
  equal(firstStamp, 'stamp')
  // The release before prints, a rollback away, kept only its own stamp.
  equal(passed(file, older, 'older schema', again.raise).stamp, 'stamp')
  equal([first.asked, again.asked], [1, 1])
})

test('its own schema stamp and a recorded print leave nothing to raise', () => {
  equal(passed(file, older, 'stamp', same.raise).stamp, null)
  equal(same.asked, 0)
})

let unfit = async () => {
  let words = (unique: boolean) =>
    loadVocab({
      $defs: {
        space: {
          component: true,
          properties: { slug: { type: 'string', unique } },
        },
        doc: { component: true, properties: { title: { type: 'string' } } },
      },
    })
  let d = preparedDriver(snapshot(words(false))), vocab = words(true)
  install(d, words(false))
  for (let [i, eid] of [ONE, TWO].entries()) {
    d.query(insert('entity', { id: i + 1, eid }))
    d.query(insert('space', { entity: i + 1, slug: 'same' }))
  }
  let held = new Map([['name', PLATFORM_STORE], ['schema', 'older schema']])
  let reports: { error: Error; tags: Record<string, string> }[] = []
  let store = storage(d, vocab, { schemaReady: () => true })
  let wake = () =>
    fitSchema(
      d,
      {
        vocab,
        print: 'unsatisfiable',
        stamp: 'stamp',
        own: false,
        key: 'spaces',
      },
      (key) => held.get(key) ?? null,
      (key, value) => void held.set(key, value),
      () => 'release',
      (error, tags) => void reports.push({ error, tags }),
    )
  let left = wake()
  await store.tx((tx) =>
    tx.patch([{
      entity: { eid: '30000000-0000-4000-8000-000000000003' },
      doc: { title: '' },
    }])
  )
  await store.tx((tx) =>
    tx.patch([{
      entity: { eid: '30000000-0000-4000-8000-000000000003' },
      doc: { title: 'Ada' },
    }])
  )
  await store.get(['30000000-0000-4000-8000-000000000003'], ['doc'])
  return { d, store, held, reports, left }
}
let failedFit = await unfit()
let servingFit = await unfit()

test('a declared index the rows cannot satisfy is reported, and the store serves', () => {
  let { d, held, reports, left } = failedFit
  assertEquals(catalogue(d, { name: 'space_slug' }), [])
  assertEquals(held.get('schema'), 'older schema')
  assertEquals(reports.length, 1)
  assertEquals(reports[0].error, left[0])
  assertEquals(reports[0].tags, {
    request: 'schema fit',
    store: PLATFORM_STORE,
  })
  assert(reports[0].error.message.includes('space_slug is not built'))
})

test('a store whose schema fit left an index undone still accepts edits', async () => {
  let { store } = servingFit
  let eid = '30000000-0000-4000-8000-000000000003'
  await store.tx((tx) => tx.patch([{ entity: { eid }, doc: { title: 'Cy' } }]))
  assertEquals((await store.get([eid], ['doc']))[0].doc, { title: 'Cy' })
})

let retry = pass()
let retryShape = shape('stuck')
test('a schema pass left undone is retried on its next wake', () => {
  let stuck = new Error('space_slug is not built')
  equal(passed(file, retryShape, null, pass([stuck]).raise), {
    left: [stuck],
    stamp: null,
  })
  equal(passed(file, retryShape, null, retry.raise).stamp, 'stamp')
  equal(retry.asked, 1)
})
