// Scripted replies drive the ordinary native oracle bridge and session runner.
// This checks measurement, growth visibility and fork isolation, not model quality.
import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import {
  appendEntry,
  sessionDoc,
  sessions,
  sessionTools,
  settle,
  type ToolContext,
  transcript,
} from '@yaks/session'
import { effectDoc } from '@yaks/effects'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc, type Request } from '@yaks/model'
import { contextDoc } from '@yaks/context'
import { docDoc } from '@yaks/doc/vocab'
import { memoryDoc } from '@yaks/memory/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { topicEid, topics } from '../packages/memory/topic.ts'
import { token } from '@yaks/graph/guard'
import { HARNESS } from '@yaks/harness/default'
import { oracleDoc } from '@yaks/oracle/vocab'
import { runs } from '@yaks/oracle/tools'
import {
  changedTopics,
  nativeTopics,
  runTopics,
  topicAnswer,
  topicState,
  topicTotals,
} from './topic-oracle.ts'
import { topicCorpus } from './topic-oracle-workload.ts'

let vocab = loadVocab([
  kernelDoc,
  edgeDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  contextDoc,
  docDoc,
  memoryDoc,
  {
    $defs: {
      contains: taskDoc.$defs!.contains,
      broader: {
        component: true,
        type: 'object',
        edge: true,
        parent: 'to',
        properties: {},
      },
    },
  },
  oracleDoc,
  effectDoc,
], [kernelKeywords, edgeKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [sessions()] })
let model = identityEid('model', ['fixture'])
let provider = identityEid('provider', ['openai'])
let root = topicEid('Oracles'), child = topicEid('Graph patches')
let grandchild = topicEid('Property clearing')
let actor = crypto.randomUUID()
let corpus = await topicCorpus()
await g.apply([
  ...corpus,
  { entity: { eid: actor }, session: { ended: true } },
  { entity: { eid: model }, model: { name: 'fixture' } },
  { entity: { eid: provider }, provider: { name: 'openai' } },
  { entity: { eid: HARNESS }, using: { provider, model } },
  { ...link(provider, 'serves', model), serves: { name: 'fixture' } },
  {
    entity: { eid: root },
    topic: { name: 'oracles' },
    doc: { title: 'Oracles' },
  },
])
let initial = await topicState(g, root)
let turn = new Map<string, number>()
let requests: Request[] = []
let call = (name: string, args: unknown) => [{
  kind: 'call' as const,
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let invoke = async (
  name: string,
  args: Record<string, unknown>,
  write = false,
) => {
  let handler = name == 'topic_new' ? topics().topic_new : runs()[name]
  let rows = await handler({
    entity: { eid: crypto.randomUUID() },
    call: { args },
    $actor: { by: actor },
  }, g)
  return JSON.stringify(write ? await g.apply(rows) : rows)
}
let childJobs: Promise<void>[] = []
let children = new Map<string, string>()
let tools = [
  {
    name: 'graph_show',
    run: async (args: Record<string, unknown>) =>
      JSON.stringify(await g.get(args.ids as string[])),
  },
  {
    name: 'graph_apply',
    run: async (args: Record<string, unknown>) =>
      JSON.stringify(await g.apply(args.bundles as Bundle[])),
  },
  ...['topic_new', 'oracle_read', 'oracle_revise'].map((name) => ({
    name,
    run: (args: Record<string, unknown>) =>
      invoke(name, args, name == 'topic_new'),
  })),
  {
    name: 'oracle_query',
    run: async (args: Record<string, unknown>, ctx?: ToolContext) => {
      let [row] = await runs().oracle_query({
        entity: { eid: crypto.randomUUID() },
        call: { args },
        $actor: { by: ctx!.session },
      }, g)
      children.set(ctx!.session, row.entity.eid)
      childJobs.push(idle(row.entity.eid))
      return JSON.stringify([row])
    },
  },
  ...sessionTools(g).filter((tool) => tool.name == 'wait'),
].map((tool) => ({ ...tool, description: tool.name, parameters: {} }))
let contexts = (
  oracle: string,
  prefix: string,
  was: Record<string, unknown>,
) => ({
  oracle,
  was,
  ...Object.fromEntries(['self', 'parent', 'children'].map((slot) => [slot, {
    body: `${prefix}-${slot}`,
    evidence: [corpus[0].entity.eid],
  }])),
})
let growing = new Map<string, boolean>()
let idle = (session: string) =>
  settle(g, session, {
    holder: actor,
    tools,
    model: async (r) => {
      requests.push(r)
      if (requests.length > 35) throw new Error('Scripted request bound')
      let n = turn.get(r.conversation!) ?? 0
      turn.set(r.conversation!, n + 1)
      let [dialogue] = await g.get([r.conversation!], ['oracle_dialogue'])
      let isChild = (dialogue.oracle_dialogue as Comp).to == child
      if (!growing.has(r.conversation!)) {
        growing.set(r.conversation!, !(await g.get([child])).length)
      }
      let was = { self: null, parent: null, children: null }
      let learn = (name: string, body: string, prefix: string) => [
        () => call('topic_new', { name, body }),
        () => call('oracle_read', { oracle: topicEid(name) }),
        () => call('oracle_revise', contexts(topicEid(name), prefix, was)),
      ]
      let steps = [
        () => call('graph_show', { ids: [corpus[0].entity.eid] }),
        ...learn('Graph patches', 'Editing entity properties.', 'child-v1'),
        ...learn('Property clearing', 'Clearing a property.', 'twohop'),
        () =>
          call('graph_apply', {
            bundles: [
              link(root, 'contains', child),
              link(child, 'broader', grandchild),
              link(root, 'reads', grandchild),
              link(grandchild, 'cites', root),
            ],
          }),
        () =>
          call('oracle_query', { oracle: child, text: 'How do patches work?' }),
      ]
      let items
      if (isChild) {
        items = [{ kind: 'assistant' as const, text: 'Null clears the value.' }]
      } else if (growing.get(r.conversation!) && n < steps.length) {
        items = steps[n]()
      } else if (
        (growing.get(r.conversation!) && n == steps.length) ||
        (!growing.get(r.conversation!) && n == 1)
      ) {
        items = call('wait', {
          children: [children.get(r.conversation!)],
          timeout: 1000,
        })
      } else if (growing.get(r.conversation!) && n == steps.length + 2) {
        items = call('oracle_read', { oracle: child })
      } else if (growing.get(r.conversation!) && n == steps.length + 3) {
        let [node] = await g.get([child])
        items = call(
          'oracle_revise',
          contexts(
            child,
            'child-v2',
            Object.fromEntries(
              Object.entries(node.topic_context as Comp).map((
                [slot, value],
              ) => [slot, token(value)]),
            ),
          ),
        )
      } else if (!growing.get(r.conversation!) && n == 0) {
        items = call('oracle_query', {
          oracle: child,
          text: 'How do patches work?',
        })
      } else {
        items = [{
          kind: 'assistant' as const,
          text: 'Use null; omitted values stay.',
        }]
      }
      return {
        id: crypto.randomUUID(),
        model: 'fixture',
        items,
        usage: { input_tokens: 2, output_tokens: 1, cached_tokens: 0 },
        cost: 0.01,
      }
    },
  })
let saved: unknown[] = []
let host = nativeTopics(g, {
  idle,
  send: (session, text) => Promise.resolve(appendEntry(g, session, text)),
  transcript: (session) => transcript(g, session),
}, actor)
await g.apply(tools.map((tool) => ({
  entity: { eid: identityEid('tool', [tool.name]) },
  tool: { name: tool.name },
})))
let results = await runTopics({
  graph: g,
  host,
  root,
  mode: 'scripted',
  cases: [
    { id: 'first', text: 'Clear a value?', followups: ['And siblings?'] },
    {
      id: 'reuse',
      text: 'Clear it in a local script?',
    },
  ],
  save: (result) => {
    saved.push(structuredClone(result))
    return Promise.resolve()
  },
})

await Promise.all(childJobs)
let first = results[0].turns[0]
let continuation = results[0].turns[1]
let reuse = results[1].turns[0]
test('topic measurement starts at root and records research-driven growth through native tools', () => {
  equal(initial.nodes.length, 1)
  equal(first.error, null)
  equal(first.answer, 'Use null; omitted values stay.')
  equal(first.changes.added.filter((row) => row.topic).length, 2)
  equal(first.calls.filter((call) => call.name == 'oracle_revise').length, 2)
  equal(
    first.after.edges.flatMap((row) =>
      ['contains', 'broader', 'reads', 'cites'].filter((tag) => row[tag])
    ).sort(),
    ['broader', 'cites', 'contains', 'reads'],
  )
  equal(first.transcripts.length, 2)
  equal(first.totals.requests, 12)
  equal(Math.round(first.totals.dollars! * 100), 12)
})
test('follow-ups keep their receiving fork while independent queries reuse learned topics', () => {
  equal(continuation.session, first.session)
  ok(reuse.session != first.session)
  equal(reuse.before.nodes.length, 3)
  equal(reuse.changes.added.filter((row) => row.topic).length, 0)
  equal(reuse.totals.requests, 4)
  equal(reuse.totals.inputTokens, 8)
  equal(saved.length, 3)
  equal(
    results.flatMap((c) => c.turns).reduce((n, t) => n + t.totals.requests, 0),
    requests.length,
  )
})
test('prebuilt trees cannot substitute for a query-grown workload', async () => {
  await throws(() =>
    runTopics({
      graph: g,
      host,
      root,
      mode: 'scripted',
      cases: [{ id: 'x', text: 'Question' }],
      save: () => Promise.resolve(),
    })
  )
})
test('directional one-hop context is pinned while corrections affect later receiving conversations', () => {
  let instructions = (session: string) =>
    requests.find((req) => req.conversation == session)!
      .items.filter((item) => item.kind == 'instruction').map((item) =>
        item.text
      ).join('\n')
  let firstChild = first.transcripts.find((t) => t.session != first.session)!
  let laterChild = reuse.transcripts.find((t) =>
    t.session != first.session && t.session != continuation.session &&
    t.session != reuse.session && t.session != firstChild.session
  )!
  ok(instructions(firstChild.session).includes('child-v1-self'))
  ok(instructions(firstChild.session).includes('twohop-children'))
  equal(instructions(firstChild.session).includes('twohop-parent'), false)
  equal(instructions(firstChild.session).includes('twohop-self'), false)
  ok(instructions(laterChild.session).includes('child-v2-self'))
  let opening = instructions(reuse.session!)
  ok(opening.includes('child-v2-parent'))
  equal(opening.includes('child-v2-self'), false)
  equal(opening.includes('child-v2-children'), false)
  for (let slot of ['self', 'parent', 'children']) {
    equal(opening.includes(`twohop-${slot}`), false)
  }
  equal(instructions(first.session!).includes('child-v2-parent'), false)
  ok(continuation.changes.updated.some((row) => row.topic_context))
})
test('typed placements and context revisions survive state diffing without duplicate topics', () => {
  let diff = changedTopics(first.after, reuse.after)
  equal(diff.updated.filter((row) => row.topic).length, 1)
  equal(diff.added.filter((row) => row.topic).length, 0)
  equal(reuse.after.contexts.filter((row) => row.content).length, 6)
})

let completed = [
  {
    entity: { eid: 'input' },
    entry: { seq: 1 },
    content: { body: 'Question' },
  },
  { entity: { eid: 'ask' }, entry: { seq: 2 }, ask: { through: 'input' } },
  {
    entity: { eid: 'output' },
    entry: { seq: 3 },
    output: { source: 'ask' },
    content: { body: 'Answer' },
  },
]
test('partial prose, reasoning, failed and stopped native turns never become successful answers', () => {
  equal(topicAnswer(completed), 'Answer')
  for (let mark of [{ exception: {} }, { refusal: {} }, { stop: {} }]) {
    equal(
      topicAnswer([...completed, {
        entity: { eid: 'end' },
        entry: { seq: 4 },
        ...mark,
      }]),
      null,
    )
  }
  equal(
    topicAnswer(
      completed.map((row) => row.output ? { ...row, reasoning: {} } : row),
    ),
    null,
  )
  equal(
    topicAnswer([...completed, {
      entity: { eid: 'followup' },
      entry: { seq: 4 },
      content: { body: 'More?' },
    }]),
    null,
  )
})
test('missing native cost and usage are unknown rather than free', () => {
  equal(topicTotals(completed).dollars, null)
  equal(topicTotals(completed).inputTokens, null)
  equal(topicTotals(completed).requests, 1)
})
