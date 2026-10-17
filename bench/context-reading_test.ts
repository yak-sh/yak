import { equal, test, throws } from '@yaks/testing'
import {
  candidate,
  evidenceRows,
  readOnly,
  recording,
  score,
  totals,
} from './context-reading.ts'
import type { Model, Request } from '@yaks/model'

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

test('manual points retain denominator and missing values', () => {
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
  throws(() => score(points, [{ id: 'a', value: 1, evidence: [] }]))
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

test('evidence strips queues, credentials and transcript semantics and rejects later text', () => {
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
  throws(() => evidenceRows([row], '2020-01-01T00:00:00Z'))
  throws(() => evidenceRows([{ entity: row.entity }], '2020-01-02T00:00:00Z'))
})
