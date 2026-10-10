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
let storageError = new Error('database is full')

let fixture = async (
  phase: 'model' | 'compaction' | 'forced',
  fails: boolean,
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
          : original,
      ),
    tools: [],
    mint: () => `entry-${++n}`,
    report: (error, from, at) => {
      equal(from, session)
      equal(at, phase == 'model' ? 'model' : 'compaction')
      reported.push(error)
    },
    ...(phase != 'model'
      ? {
        compactAt: phase == 'compaction' ? 0.1 : 0.9,
        compactModel: {
          name: 'report-test',
          model: () => Promise.reject(original),
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

for (let phase of ['model', 'compaction', 'forced'] as const) {
  for (let fails of [false, true]) {
    // Fixture composition is shared setup, outside the timed behavior.
    let { g, deps, saved, reported } = await fixture(phase, fails)
    test(`${phase} defects ${fails ? 'report their original error when recording fails' : 'report through their exception alone'}`, async () => {
      let caught: unknown
      try {
        await react(g, session, deps)
      } catch (error) {
        caught = error
      }
      equal(caught, fails ? storageError : undefined)
      equal(reported, fails ? [original] : [])
      if (fails) equal(reported[0] === original, true)
      equal(saved.length, fails ? 0 : 1)
      if (!fails) {
        equal(saved[0].exception as Comp, {
          type: original.name,
          value: original.message,
          stack: original.stack,
        })
        equal((await g.read('.exception')).length, 1)
      }
    })
  }
}
