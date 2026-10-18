import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, identityEid } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc, ModelError } from '@yaks/model'
import { taskDoc } from '@yaks/task/vocab'
import { sessionDoc } from './comp.ts'
import { type Deps, react } from './react.ts'
import { transcriptGraph } from './testing.ts'

let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  modelDoc,
  taskDoc,
  sessionDoc,
], [kernelKeywords])
let model = identityEid('model', ['report-test'])
let session = 'report-session'
let original = new TypeError('model defect')
let exception = {
  type: original.name,
  value: original.message,
}
let storageError = new Error('database is full')

let fixture = async (
  phase: 'model' | 'compaction' | 'forced' | 'context',
  fails: boolean,
  error: Error = original,
) => {
  let g = transcriptGraph(vocab)
  await g.apply([
    {
      entity: { eid: model },
      model: { name: 'report-test', context: 100_000 },
    },
    { entity: { eid: session }, session: {} },
    {
      entity: { eid: 'input' },
      entry: { session },
      using: { model },
      content: {
        body: phase == 'compaction' ? 'history'.repeat(60) : 'history',
      },
    },
  ], { trusted: true })
  let saved: Bundle[] = [], reported: unknown[] = []
  let apply = g.apply.bind(g)
  g.apply = (rows, opts) => {
    if (rows.some((b) => b.exception)) {
      if (fails) throw storageError
      saved.push(...rows.filter((b) => b.exception))
    }
    return apply(rows, opts)
  }
  let n = 0
  let deps: Deps = {
    model: () =>
      Promise.reject(
        phase == 'forced'
          ? new ModelError('context_length_exceeded', 'too long')
          : error,
      ),
    tools: [],
    mint: () => `entry-${++n}`,
    report: (error, from, at) => {
      equal(from, session)
      equal(
        at,
        phase == 'context'
          ? 'context'
          : phase == 'model'
          ? 'model'
          : 'compaction',
      )
      reported.push(error)
    },
    ...(phase == 'context'
      ? {
        requestItems: () => {
          throw error
        },
      }
      : {}),
    ...(phase == 'compaction' || phase == 'forced'
      ? {
        compactAt: phase == 'compaction' ? 0.1 : 0.9,
        compactModel: {
          name: 'report-test',
          model: () => Promise.reject(error),
        },
      }
      : {}),
  }
  if (phase == 'compaction') {
    await apply([{
      entity: { eid: model },
      model: { context: 100 },
    }], { trusted: true })
  }
  return { g, deps, saved, reported }
}

for (let phase of ['model', 'compaction', 'forced', 'context'] as const) {
  for (let fails of [false, true]) {
    // Fixture composition is shared setup, outside the timed behavior.
    let { g, deps, saved, reported } = await fixture(phase, fails)
    test(`${phase} defects ${fails ? 'report their original error when recording fails' : 'report their original error and keep history'}`, async () => {
      let caught: unknown
      try {
        await react(g, session, deps)
      } catch (error) {
        caught = error
      }
      equal(caught, fails ? storageError : undefined)
      equal(reported, [original])
      equal(reported[0] === original, true)
      equal(saved.length, fails ? 0 : 1)
      if (!fails) {
        equal(saved[0].exception as Comp, exception)
        equal((await g.read('.exception')).length, 1)
        if (phase == 'context') {
          equal(((await g.get([session]))[0].session as Comp).status, 'failed')
          let again = await react(g, session, deps)
          equal(again.did, 'nothing')
          equal(reported, [original])
        }
      }
    })
  }
}

for (let phase of ['model', 'compaction'] as const) {
  let error = new ModelError(
    'transport',
    'responses: transport failed — TypeError: network http2 reset',
    { after: 0 },
  )
  let { g, deps, reported, saved } = await fixture(phase, false, error)
  test(`${phase} exhausted transport reaches the reporter despite transient message text`, async () => {
    await react(g, session, deps)
    equal(reported, [error])
    // Transport failures retain their interrupted/retry history, not an exception.
    equal(saved.length, 0)
  })
}

let stalled = new ModelError(
  'stalled',
  'responses: transport stalled (timeout)',
)
let retrying = new ModelError('transport', 'HTTP pool is closed', { after: 0 })
let retryFixture = await fixture('model', false, retrying)
test('a transport failure reaches the reporter while its effect still owes a retry', async () => {
  let failure: unknown
  try {
    await react(retryFixture.g, session, {
      ...retryFixture.deps,
      attempt: { last: () => false, progressed: () => Promise.resolve() },
    })
  } catch (error) {
    failure = error
  }
  equal(failure, retrying)
  equal(retryFixture.reported, [retrying])
  equal(retryFixture.saved, [])
})
let stalledFixture = await fixture('model', false, stalled)
test('a stalled provider reaches the reporter with its original failure', async () => {
  await react(stalledFixture.g, session, stalledFixture.deps)
  equal(stalledFixture.reported, [stalled])
})
