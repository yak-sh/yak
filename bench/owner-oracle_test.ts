import { equal, test, throws } from '@yaks/testing'
import type { Model, Request } from '@yaks/model'
import { ownerOracle, ownerWords } from './owner-oracle.ts'
import { recording, totals } from './context-reading.ts'

const rows = [{
  entity: { eid: 'synthetic-source' },
  created: { at: '2020-01-01T00:00:00Z' },
  content: { body: 'I am away; decide reversible work.' },
  held_out: { label: 'NEVER_LABEL' },
  secret: { value: 'NEVER_CREDENTIAL' },
  entry: { session: 'NEVER_LIVE_SESSION' },
}]
const cutoff = '2020-01-02T00:00:00Z'

test('owner projection admits only strictly earlier verbatim text', () => {
  equal(ownerWords(rows, cutoff), [{
    id: 'synthetic-source',
    at: '2020-01-01T00:00:00Z',
    words: 'I am away; decide reversible work.',
  }])
  throws(() => ownerWords(rows, rows[0].created.at))
  throws(() => ownerWords(rows, 'not-a-date'))
  throws(() => ownerWords([{ entity: { eid: 'missing' } }], cutoff))
})

test('growth chooses structure and query forks never inherit another answer', async () => {
  let seen: Request[] = []
  let fake: Model = (r) => {
    seen.push(structuredClone(r))
    return Promise.resolve({
      id: 'r' + seen.length,
      model: r.model,
      items: [{
        kind: 'assistant',
        text: seen.length == 1
          ? 'My own organization: evidence and caveats.'
          : 'answer-' + seen.length,
      }],
      usage: { input_tokens: 5, output_tokens: 3, cached_tokens: 0 },
    })
  }
  let calls: Parameters<typeof totals>[0] = []
  let oracle = await ownerOracle({
    rows,
    cutoff,
    grow: recording(fake, calls),
    query: recording(fake, calls),
  })
  equal(await oracle.tool.run({ question: 'First question' }), 'answer-2')
  equal(await oracle.tool.run({ question: 'Second question' }), 'answer-3')
  equal(seen[1].items.slice(0, -1), seen[2].items.slice(0, -1))
  equal(seen[1].conversation == seen[2].conversation, false)
  equal(JSON.stringify(seen[2]).includes('answer-2'), false)
  for (
    let forbidden of ['NEVER_LABEL', 'NEVER_CREDENTIAL', 'NEVER_LIVE_SESSION']
  ) {
    equal(JSON.stringify(seen).includes(forbidden), false)
  }
  equal(totals(calls).calls, 3)
  equal(totals(calls).inputTokens, 15)
  equal(totals(calls).dollars, null)
  equal(oracle.evidence.queries.length, 2)
})

test('failed oracle queries remain in the call and fork ledger', async () => {
  let calls: Parameters<typeof totals>[0] = []
  let grow: Model = (r) =>
    Promise.resolve({
      id: 'grown',
      model: r.model,
      items: [{ kind: 'assistant', text: 'context' }],
    })
  let query: Model = () => Promise.reject(new Error('synthetic failure'))
  let oracle = await ownerOracle({
    rows,
    cutoff,
    grow: recording(grow, calls),
    query: recording(query, calls),
  })
  let failed = false
  try {
    await oracle.tool.run({ question: 'fail' })
  } catch {
    failed = true
  }
  equal(failed, true)
  equal(calls.length, 2)
  equal(calls[1].error?.includes('synthetic failure'), true)
  equal(oracle.evidence.queries[0].error?.includes('synthetic failure'), true)
  equal(totals(calls).inputTokens, null)
})

let interleavedRoles = await (async () => {
  let resolve: (value: Awaited<ReturnType<Model>>) => void = () => {}
  let pending: Model = () =>
    new Promise((r) => {
      resolve = r
    })
  let immediate: Model = (r) =>
    Promise.resolve({ id: 'fast', model: r.model, items: [] })
  let calls: Parameters<typeof totals>[0] = []
  let req: Request = { model: 'synthetic', items: [], tools: [] }
  let slow = recording(pending, calls, true, 'oracle')(req)
  // recording hashes the request before invoking the transport.
  while (!calls.length) await new Promise((r) => setTimeout(r, 0))
  await recording(immediate, calls, true, 'candidate')(req)
  resolve({ id: 'slow', model: 'synthetic', items: [] })
  await slow
  return calls
})()
test('role is attached at call entry despite interleaved completions', () => {
  equal(interleavedRoles.map((c) => c.role), ['oracle', 'candidate'])
  equal(interleavedRoles.map((c) => c.response?.id), ['slow', 'fast'])
})
