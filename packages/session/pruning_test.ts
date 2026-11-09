import { equal, test } from '@yaks/testing'
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { type Model, modelDoc, type Request } from '@yaks/model'
import { executionComputed, toolsDoc } from '@yaks/tools'
import { contextDoc } from '@yaks/context'
import { taskDoc } from '@yaks/task/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { attemptComputed } from './attempt.ts'
import { settle } from './run.ts'
import { transcript } from './transcript.ts'
import { context } from './compact.ts'
import { pruning } from './pruning.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  sessionDoc,
  modelDoc,
  toolsDoc,
  contextDoc,
  taskDoc,
  docDoc,
  edgeDoc,
], [kernelKeywords, edgeKeywords])
let g = graph({
  vocab,
  storage: ram(vocab, {
    computed: { ...attemptComputed, ...executionComputed },
  }),
  plugins: [sessions()],
})
let m = identityEid('model', ['pruning-model'])
let line = (seq: number, comps: object): Bundle => ({
  entity: { eid: `line-${seq}` },
  entry: { session: 'conversation', seq },
  ...comps,
})
let requests: Request[] = []
let model: Model = (request) => {
  requests.push(request)
  return Promise.resolve({
    id: 'reply-' + requests.length,
    model: request.model,
    items: [{ kind: 'assistant', text: 'Received.' }],
  })
}
model.anchor = (entry) => (entry.entity as { eid: string }).eid
await g.apply([
  { entity: { eid: m }, model: { name: 'pruning-model' } },
  { entity: { eid: 'holder' } },
  { entity: { eid: 'conversation' }, session: {} },
  ...Array.from({ length: 100 }, (_, i) =>
    line(i + 1, {
      content: {
        body: i < 10 ? 'discarded import secret' : 'kept original ' + i,
      },
    })),
  line(101, { using: { model: m }, content: { body: 'First question.' } }),
])
let turn = async (body: string) => {
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: 'conversation' },
    content: { body },
  }])
  await settle(g, 'conversation', { holder: 'holder', model, tools: [] })
  return requests.at(-1)!
}
let checkpoint = async (body: string, fresh = false) => {
  let entries = await transcript(g, 'conversation')
  let through = entries.at(-1)!
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: 'conversation' },
    notice: {},
    checkpoint: {
      through: through.entity.eid,
      seq: (through.entry as { seq: number }).seq,
      ...fresh ? { pruning: pruning(entries) } : {},
      tasks: {},
    },
    content: { body },
  }])
}
await turn('Before compaction.')
await checkpoint('Contaminated summary: discarded import secret.')
await checkpoint('Summary of contaminated summary: discarded import secret.')
await turn('Before archiving.') // warms bounded-read caches and provider anchor
let span = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`)
await g.apply(span.map((eid) => ({ entity: { eid }, archived: {} })))
let archived = await turn('After archiving.')
await checkpoint('Fresh filtered summary.', true)
let compacted = await turn('After clean compaction.')
await g.apply(span.map((eid) => ({ entity: { eid }, archived: null })))
let restored = await turn('After restoring.')
let said = (request: Request) => JSON.stringify(request.items)

test('an archived span and summaries of it leave the next model prompt, including below warm bounded reads', () => {
  equal(said(archived).includes('discarded import secret'), false)
  equal(said(archived).includes('Contaminated summary'), false)
  equal(said(archived).includes('kept original 10'), true)
  equal(archived.anchor, undefined)
})

test('fresh summaries after pruning are usable, and restoration changes provider history again', () => {
  equal(said(compacted).includes('Fresh filtered summary.'), true)
  equal(said(compacted).includes('discarded import secret'), false)
  equal(said(restored).includes('discarded import secret'), true)
  equal(said(restored).includes('Fresh filtered summary.'), false)
  equal(restored.anchor, undefined)
})

test('archive and restore keep the original entries readable', async () => {
  let rows = await g.get(span)
  equal(rows.length, 10)
  equal(
    rows.every((b) =>
      !b.archived &&
      (b.content as { body: string }).body == 'discarded import secret'
    ),
    true,
  )
})

for (let archived of ['call', 'result']) {
  test(`archiving a ${archived} omits its whole protocol pair`, () => {
    let entries = [
      line(1, {
        call: { id: 'c', to: 'tool' },
        ...archived == 'call' ? { archived: {} } : {},
      }),
      line(2, {
        result: { call: 'line-1' },
        content: { body: 'tool result' },
        ...archived == 'result' ? { archived: {} } : {},
      }),
      line(3, { content: { body: 'Continue.' } }),
    ]
    equal(context(entries).map((b) => b.entity.eid), ['line-3'])
  })
}

test('archiving a late summary excludes a later summary drawn from it', () => {
  let entries = [
    line(1, { content: { body: 'kept' } }),
    line(2, { content: { body: 'also kept' } }),
    line(5, {
      checkpoint: { through: 'line-1', seq: 1 },
      content: { body: 'summary' },
      archived: {},
    }),
    line(7, {
      checkpoint: { through: 'line-2', seq: 2 },
      content: { body: 'summary of summary' },
    }),
  ]
  equal(context(entries).map((b) => b.entity.eid), ['line-1', 'line-2'])
})
