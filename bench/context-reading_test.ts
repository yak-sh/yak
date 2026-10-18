import { equal, test, throws } from '@yaks/testing'
import {
  candidate,
  evidenceRows,
  finalCandidate,
  measuredTree,
  readOnly,
  recording,
  score,
  totals,
  treeRows,
} from './context-reading.ts'
import type { Item, Model, Request } from '@yaks/model'

const c = {
  id: 'synthetic',
  input: {
    original_message: {
      exact_words: 'Explain this.',
      timestamp: '2020-01-01T00:00:00Z',
    },
    ideal_context: { text: 'SECRET_IDEAL' },
  },
  held_out: { answer: 'SECRET_ANSWER', rubric: 'SECRET_RUBRIC' },
}

test('candidate projects only explicitly supplied context and message', () => {
  let prompt = candidate(c, { id: 'base', text: '' })
  equal(prompt.includes('SECRET'), false)
  equal(
    prompt.includes('Original message timestamp: 2020-01-01T00:00:00Z'),
    true,
  )
  equal(
    prompt.endsWith(
      '--- ORIGINAL OWNER MESSAGE ---\nExplain this.\n--- END ORIGINAL OWNER MESSAGE ---',
    ),
    true,
  )
  equal(
    candidate(c, {
      id: 'context',
      text: 'fallback',
      contexts: { synthetic: 'selected' },
    }).includes(
      '--- CONTEXT (background only) ---\nselected\n--- END CONTEXT ---',
    ),
    true,
  )
})

test('manual points retain denominator and missing values', async () => {
  let points = [{ id: 'a', evidence: ['graph:a'] }, {
    id: 'b',
    evidence: ['graph:b'],
  }]
  let grade = [{ id: 'a', value: 1 as const, evidence: ['graph:a'] }]
  equal(score(points, grade), {
    denominator: 2,
    assigned: 1,
    missing: 1,
    earned: 1,
    fraction: null,
    failed: false,
  })
  equal(
    score(points, [...grade, {
      id: 'b',
      value: 0,
      evidence: ['graph:b'],
    }]).fraction,
    0.5,
  )
  equal(score(points, grade, true).earned, null)
  equal(score([], []).fraction, null)
  await throws(() => score(points, [{ id: 'a', value: 1, evidence: [] }]))
})

test('failed or missing call accounting is unknown not zero', () => {
  equal(totals([]).dollars, null)
  equal(
    totals([{
      request: {},
      contextHash: 'synthetic',
      response: null,
      error: 'failed',
      wallMs: 7,
    }]),
    {
      calls: 1,
      callWallMs: 7,
      inputTokens: null,
      cachedTokens: null,
      outputTokens: null,
      dollars: null,
      dollarsReported: null,
    },
  )
})

const req: Request = {
  model: 'synthetic',
  items: [{ kind: 'user', text: 'visible' }],
  tools: [],
}
const reply = {
  id: 'synthetic',
  model: 'synthetic',
  items: [],
  usage: { input_tokens: 10, output_tokens: 2, cached_tokens: 4 },
  cost: 0.1,
}
let calls: Parameters<typeof recording>[1] = []
let model: Model = () => Promise.resolve(reply)
await recording(model, calls)(req)

test('recording retains exact model-facing request and totals all calls', () => {
  equal(calls[0].request, req)
  equal(calls[0].contextHash.length, 64)
  equal(totals([...calls, ...calls]).inputTokens, 20)
  equal(totals([...calls, ...calls]).cachedTokens, 8)
  equal(totals([...calls, ...calls]).dollars, 0.2)
})

test('native recording retains full offered schemas and accepts tool-only replies', async () => {
  let calls: Parameters<typeof recording>[1] = []
  let reqWithTools = {
    ...req,
    tools: [{
      name: 'graph_show',
      description: 'Read',
      parameters: { type: 'object' },
    }],
  }
  let toolOnly = {
    ...reply,
    items: [{
      kind: 'call' as const,
      id: 'c',
      name: 'graph_show',
      args: JSON.stringify({ ids: ['prior'] }),
    }],
  }
  let model = Object.assign(() => Promise.resolve(toolOnly), {
    anchor: () => 'synthetic',
  }) as Model
  let wrapped = recording(model, calls, true)
  await wrapped(reqWithTools)
  equal((calls[0].request as Request).tools, reqWithTools.tools)
  equal(calls[0].response, toolOnly)
  equal(wrapped.anchor, model.anchor)
})

test('sandbox preserves schemas but never invokes action or recovery handlers', async () => {
  let entered = 0
  let tools = ['shell', 'graph_apply', 'spawn', 'skill_read', 'graph_show'].map(
    (name) => ({
      name,
      description: name,
      parameters: { type: 'object' },
      run: () => {
        entered++
        return Promise.resolve('isolated read')
      },
      recover: () => {
        entered++
        return Promise.resolve('recovered')
      },
    }),
  )
  let safe = readOnly(tools)
  for (let i = 0; i < safe.length; i++) {
    equal(safe[i].name, tools[i].name)
    equal(safe[i].description, tools[i].description)
    equal(safe[i].parameters, tools[i].parameters)
    if (safe[i].name != 'graph_show') {
      await safe[i].run({})
      equal(safe[i].recover, undefined)
    }
  }
  equal(entered, 0)
  await safe[4].run({})
  equal(entered, 1)
})

test('evidence strips queues, credentials and transcript semantics and rejects later text', async () => {
  let row = {
    entity: { eid: 'prior' },
    content: { body: 'earlier evidence' },
    created: { at: '2020-01-01T00:00:00Z' },
    entry: { session: 'production' },
    secret: { value: 'never lend' },
  }
  equal(evidenceRows([row], '2020-01-02T00:00:00Z'), [{
    entity: row.entity,
    content: row.content,
    created: row.created,
  }])
  await throws(() => evidenceRows([row], '2020-01-01T00:00:00Z'))
  await throws(() =>
    evidenceRows([{ entity: row.entity }], '2020-01-02T00:00:00Z')
  )
})

test('native evidence compares instants rather than timestamp spellings', async () => {
  let row = {
    entity: { eid: 'offset' },
    created: { at: '2020-01-02T00:30:00+02:00' },
    content: { body: 'prior' },
  }
  equal(evidenceRows([row], '2020-01-01T23:00:00Z').length, 1)
  await throws(() =>
    evidenceRows(
      [{ ...row, created: { at: '2020-01-01T22:30:00-02:00' } }],
      '2020-01-01T23:00:00Z',
    )
  )
  await throws(() => evidenceRows([row], 'invalid'))
})

test('final candidate must consume completed tools, not oracle or pending prose', () => {
  let entries = [
    {
      entity: { eid: 'input' },
      entry: { seq: 1 },
      content: { body: 'question' },
    },
    { entity: { eid: 'ask1' }, entry: { seq: 2 }, ask: { through: 'input' } },
    { entity: { eid: 'call' }, entry: { seq: 3 }, call: {} },
    {
      entity: { eid: 'pending' },
      entry: { seq: 4 },
      output: { source: 'ask1' },
      content: { body: 'Still pending' },
    },
    {
      entity: { eid: 'result' },
      entry: { seq: 5 },
      result: { call: 'call' },
      content: { body: 'Oracle prose' },
    },
  ]
  equal(finalCandidate(entries), null)
  // A delayed old response after the result still did not consume it.
  equal(
    finalCandidate([...entries, {
      entity: { eid: 'late' },
      entry: { seq: 6 },
      output: { source: 'ask1' },
      content: { body: 'old answer' },
    }]),
    null,
  )
  equal(
    finalCandidate([...entries, {
      entity: { eid: 'ask2' },
      entry: { seq: 6 },
      ask: { through: 'result' },
    }, {
      entity: { eid: 'final' },
      entry: { seq: 7 },
      output: { source: 'ask2' },
      content: { body: 'Final interpretation' },
    }]),
    'Final interpretation',
  )
})

const treeEvidence = [{
  entity: { eid: 'tree-evidence' },
  created: { at: '2019-01-01T00:00:00Z' },
  content: { body: 'Synthetic earlier blue rendering seam.' },
  held_out: { answer: 'NEVER_TREE_LABEL' },
  secret: { value: 'NEVER_TREE_KEY' },
}]
const treeCutoff = '2020-01-01T00:00:00Z'
const treeContext = (title = 'Directory') => ({
  advert: { title, description: 'Synthetic routing only.' },
  self: 'Synthetic bounded context.',
  shared: 'Synthetic shared context.',
  evidence: ['tree-evidence'],
})
const treeCall = (name: string, args: unknown): Item => ({
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
})
let treeRequests: Request[] = []
let treeResponder: (r: Request) => Item[] = (r) => {
  if (r.tools.some((t) => t.name == 'publish_oracle')) {
    let root = r.items[0].kind == 'instruction' &&
      r.items[0].text.includes('The oracle directory:')
    return [treeCall('publish_oracle', {
      ...treeContext(),
      children: root
        ? [{
          domain: 'Parent assigned blue seam, not the child advertisement.',
          evidence: ['tree-evidence'],
          tools: ['query_oracle', 'revise_oracle'],
        }]
        : [],
    })]
  }
  return [{ kind: 'assistant', text: 'Synthetic blue seam.' }]
}
const treeModel: Model = (r) => {
  treeRequests.push(structuredClone(r))
  return Promise.resolve({ ...reply, model: r.model, items: treeResponder(r) })
}
const measured = await measuredTree({
  rows: treeEvidence,
  cutoff: treeCutoff,
  model: treeModel,
  limits: { maxNodes: 2 },
})
const opened = JSON.parse(
  await measured.tool.run({
    message: 'Original message: Explain this. Context: blue seam.',
  }) as string,
)
const continued = JSON.parse(
  await measured.tool.run({
    message: 'And what structure routes this?',
    conversation: opened.conversation,
  }) as string,
)
const separate = JSON.parse(
  await measured.tool.run({ message: 'Other asker.' }) as string,
)
const converted = await measured.calls()
const candidateCalls: Parameters<typeof recording>[1] = []
await recording(treeModel, candidateCalls, true, 'candidate-answer')(req)

test('tree corpus is validated against each case cutoff before a run', async () => {
  let packet = {
    historical_cases: [c],
    oracleTree: { rows: treeEvidence, limits: { maxNodes: 100 } },
  }
  treeRows(packet, true)
  await throws(() => treeRows(packet, false))
  await throws(() => treeRows({ ...packet, ownerOracle: true }, true))
  await throws(() =>
    treeRows({
      ...packet,
      historical_cases: [c, {
        ...c,
        id: 'earlier',
        input: {
          original_message: {
            exact_words: 'Earlier',
            timestamp: '2018-01-01T00:00:00Z',
          },
        },
      }],
    }, true)
  )
})

test('native oracle tool opens and continues receiving forks without a fake asker', () => {
  equal(opened.conversation, continued.conversation)
  equal(opened.conversation == separate.conversation, false)
  equal(measured.consulted(), true)
  equal(measured.evidence().conversations.length, 2)
  equal(converted.filter((call) => call.role == 'oracle-tree-growth').length, 2)
  equal(
    converted.filter((call) => call.role == 'oracle-tree-routing-answer')
      .length,
    3,
  )
  equal(converted.some((call) => call.role == 'oracle-tree-asker'), false)
  equal(
    treeRequests.every((r) =>
      r.model == 'gpt-6.1-sol' || r.model == 'synthetic'
    ),
    true,
  )
  let conversation = measured.evidence().conversations.find((c) =>
    c.id == opened.conversation
  )!
  equal(conversation.items.filter((i) => i.kind == 'user').length, 2)
})

test('tree artifacts retain nodes and revisions while counting engine and candidate once', () => {
  let artifact = measured.evidence()
  equal(artifact.nodes.length, 2)
  equal(artifact.nodes[1].revisions.length, 1)
  equal(artifact.nodes[1].domain.includes('Parent assigned'), true)
  equal(artifact.limits.requestTokens, 100_000)
  equal(artifact.limits.evidencePageTokens, 20_000)
  equal(artifact.limits.ownTokens, 5000)
  equal(artifact.counter, 'utf8-bytes')
  equal(JSON.stringify(artifact).includes('NEVER_TREE'), false)
  equal(converted.length, artifact.trace.length)
  equal(converted.every((call) => call.contextHash.length == 64), true)
  equal(
    totals([...converted, ...candidateCalls]).calls,
    artifact.trace.length + 1,
  )
  equal(totals([...converted, ...candidateCalls]).inputTokens, 60)
  measured.assertReady()
})

const failedTree = await measuredTree({
  rows: treeEvidence,
  cutoff: treeCutoff,
  model: () => Promise.reject(new Error('synthetic root failure')),
  limits: { maxNodes: 100 },
})
const failedCalls = await failedTree.calls()
let childrenFailedModel: Model = (r) => {
  if (
    r.items[0].kind == 'instruction' &&
    r.items[0].text.includes('The oracle directory:')
  ) return treeModel(r)
  return Promise.reject(new Error('synthetic child failure'))
}
const partialTree = await measuredTree({
  rows: treeEvidence,
  cutoff: treeCutoff,
  model: childrenFailedModel,
  limits: { maxNodes: 100 },
})

test('failed growth retains serializable trace and partial nodes instead of disappearing', async () => {
  await throws(() => failedTree.assertReady())
  equal(failedCalls.length, 1)
  equal(failedCalls[0].error?.includes('synthetic root failure'), true)
  equal(totals(failedCalls).inputTokens, null)
  equal(failedTree.evidence().growthError?.includes('Root failed'), true)
  equal(JSON.parse(JSON.stringify(failedTree.evidence())).trace.length, 1)
  partialTree.assertReady()
  equal(partialTree.evidence().nodes.length, 2)
  equal(partialTree.evidence().stats.readyNodes, 1)
  equal(partialTree.evidence().stats.partialErrors.length, 1)
})

let growthOnly = true
let reviewTurn = 0
const hundred = await measuredTree({
  rows: treeEvidence,
  cutoff: treeCutoff,
  limits: { maxNodes: 100 },
  model: (r) => {
    let items: Item[]
    if (growthOnly) {
      items = [treeCall('publish_oracle', {
        ...treeContext(),
        children: Array.from({ length: 9 }, (_, i) => ({
          domain: `Synthetic assigned domain ${i}`,
          evidence: ['tree-evidence'],
          tools: ['revise_oracle'],
        })),
      })]
    } else if (reviewTurn++ == 0) {
      items = [treeCall('decline', { reason: 'Wrong synthetic domain.' })]
    } else if (
      reviewTurn == 2 && r.tools.some((t) => t.name == 'revise_oracle')
    ) {
      items = [
        treeCall('revise_oracle', treeContext('Narrower routing advert')),
      ]
    } else {items = [{
        kind: 'assistant',
        text: 'Declined; advertisement corrected.',
      }]}
    return Promise.resolve({ ...reply, model: r.model, items })
  },
})
growthOnly = false
await hundred.tool.run({ message: 'Synthetic off-domain structural question.' })
const hundredCalls = await hundred.calls()

const hundredArtifact = JSON.parse(JSON.stringify(hundred.evidence()))
const hundredTotals = totals(hundredCalls)
test('hundred ready nodes answer without revising the tree during a decline', () => {
  hundred.assertReady()
  let artifact = hundredArtifact
  equal(artifact.stats.readyNodes, 100)
  equal(artifact.nodes.length, 100)
  equal(artifact.trace.length, 102)
  equal(artifact.declines[0].reason, 'Wrong synthetic domain.')
  equal(artifact.changes.length, 0)
  equal(artifact.nodes[0].revisions.length, 1)
  equal(
    hundredCalls.filter((c) => c.role == 'oracle-tree-decline-review').length,
    1,
  )
  equal(Math.round(hundredTotals.dollars! * 10), 102)
})
