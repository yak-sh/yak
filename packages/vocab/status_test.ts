import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from './mod.ts'
import type { PropSchema, VocabDoc } from './types.ts'

let comp = (more: PropSchema = {}): PropSchema => ({
  component: true,
  type: 'object',
  ...more,
})
let doc = (defs: Record<string, PropSchema>): VocabDoc => ({ $defs: defs })
let jobs = doc({
  job: comp({
    status: { failed: 'failed', finished: 'done', default: 'pending' },
    properties: { title: { type: 'string' } },
  }),
  failed: comp(),
  finished: comp(),
  held: comp(),
})
let lease = doc({
  job: comp({ extends: true, status: { held: 'running' } }),
})

test('a ladder gives its component a computed status, never written', () => {
  let v = loadVocab(jobs)
  let p = v.prop('job', 'status')!
  assertEquals([p.category, p.values, p.computed], [
    'enum',
    ['failed', 'done', 'pending'],
    true,
  ])
  assertEquals(v.comp('job')?.ladder, {
    rungs: [
      { comp: 'failed', status: 'failed' },
      { comp: 'finished', status: 'done' },
    ],
    default: 'pending',
  })
  assertEquals(v.comp('job')?.writable, ['title'])
  assertEquals(v.check('job', { status: 'done' }).length, 1)
  assertEquals(v.aim('job.status'), [{ comp: 'job', prop: 'status' }])
})

test('another document appends rungs, in load order, after the declaring one', () => {
  let more = doc({ job: comp({ extends: true, status: { gone: 'gone' } }) })
  let v = loadVocab([lease, jobs, more])
  assertEquals(v.comp('job')?.ladder?.rungs.map((r) => r.status), [
    'failed',
    'done',
    'running',
  ])
  // `gone` is declared nowhere here, so no entity can wear it
  assertEquals(v.prop('job', 'status')?.values, [
    'failed',
    'done',
    'running',
    'pending',
  ])
  // and rungs for a component nobody here declares are left out whole
  assertEquals(loadVocab([lease, doc({ held: comp() })]).all, ['held'])
})

test('the entry a vocabulary reports loads back as the same ladder', () => {
  let v = loadVocab([jobs, lease])
  let back = loadVocab(
    doc(Object.fromEntries(v.all.map((n) => [n, v.def(n)!]))),
  )
  assertEquals(back.comp('job')?.ladder, v.comp('job')?.ladder)
  assertEquals(back.prop('job', 'status'), v.prop('job', 'status'))
})

test('a ladder that cannot be read one way is refused at load', () => {
  let job = (more: PropSchema) => doc({ job: comp(more), done: comp() })
  for (
    let [docs, why] of [
      [[job({ status: { done: 'done' } })], 'names no default'],
      [[job({ status: { job: 'x', default: 'y' } })], 'the component itself'],
      [[job({ status: { done: '', default: 'y' } })], 'done gives no status'],
      [
        [job({
          status: { default: 'y' },
          properties: { status: { type: 'string' } },
        })],
        'stores none',
      ],
      [
        [jobs, doc({ job: comp({ extends: true, status: { default: 'x' } }) })],
        'not a default',
      ],
      [
        [jobs, doc({ job: comp({ extends: true, status: { failed: 'x' } }) })],
        'already reads failed',
      ],
      [
        [job({}), doc({ job: comp({ extends: true, status: { done: 'x' } }) })],
        'no status to add to',
      ],
    ] as [VocabDoc[], string][]
  ) assertThrows(() => loadVocab(docs), Error, why)
})
