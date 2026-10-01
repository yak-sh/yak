// Cache reports exercise the reduction and the graph reader over sparse usage.

import { equal, test, throws } from '@yaks/testing'
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from './comp.ts'
import { cacheOf, cacheRead, cacheTime } from './cache.ts'
import { runs } from './tools.ts'

let model = identityEid('model', ['example'])
let provider = identityEid('provider', ['openai'])
let tool = identityEid('tool', ['test'])
let at = '2026-10-01T20:10:00Z'
let request = (
  id: string,
  usage: Record<string, number> = {},
  time = at,
  session = 's',
): Bundle => ({
  entity: { eid: id },
  entry: { session, seq: 1 },
  created: { at: time },
  ask: { to: model },
  using: { provider, model },
  ...(Object.keys(usage).length ? { usage } : {}),
})
let metadata: Bundle[] = [
  { entity: { eid: 's' }, session: { source: 'c' } },
  { entity: { eid: 'c' }, call: { source: 'b', to: tool } },
  { entity: { eid: 'b' }, build: {} },
  { entity: { eid: provider }, provider: { name: 'openai' } },
  { entity: { eid: model }, model: { name: 'example' } },
]

let samples = () => [
  request('large', { input_tokens: 900, cached_tokens: 900 }),
  request('zero', { input_tokens: 100, cached_tokens: 0 }),
  request('unknown', { input_tokens: 200 }),
  request('no-usage'),
  request('no-input', { cached_tokens: 10 }),
]

test('cache share weights tokens and distinguishes unknown counts from zero', () => {
  let r = cacheOf(samples(), metadata, { requests: true })
  equal(r.total, {
    requests: 5,
    input_tokens: 1200,
    cached_tokens: 910,
    reported_input_tokens: 1000,
    reported_cached_tokens: 900,
    unknown_cache_input_tokens: 200,
    unknown_input_requests: 2,
    unknown_cache_requests: 2,
    zero_cache_requests: 1,
    cached_share: 0.9,
  })
  equal(r.groups.provider[0].key, 'openai')
  equal(r.groups.model[0].key, 'example')
  equal(r.groups.path[0].key, 'builder')
  equal(r.requests?.find((r) => r.request == 'zero')?.cached_share, 0)
  equal(r.requests?.find((r) => r.request == 'unknown')?.cached_share, null)
  equal(cacheOf([], metadata).total.cached_share, null)
  equal(
    cacheOf([request('x', { input_tokens: 0, cached_tokens: 0 })])
      .total.cached_share,
    null,
  )
})

test('cache dates bracket before and after the cache header fix exactly once', () => {
  let rows = [
    request(
      'before',
      { input_tokens: 100, cached_tokens: 0 },
      '2026-10-01T20:09:59Z',
    ),
    request('at', { input_tokens: 100, cached_tokens: 90 }),
    request(
      'after',
      { input_tokens: 100, cached_tokens: 100 },
      '2026-10-01T20:11:00Z',
    ),
    request('missing-date', {}, ''),
  ]
  equal(cacheOf(rows, [], { until: at }).total.requests, 1)
  equal(cacheOf(rows, [], { from: at }).total.requests, 2)
  equal(
    cacheOf(rows, [], { from: at, until: '2026-10-01T20:11:00Z' })
      .total.cached_share,
    0.9,
  )
  equal(cacheOf(rows, [], { session: 'different' }).total.requests, 0)
  equal(cacheTime('2026-10-01T22:10:00+02:00'), '2026-10-01T20:10:00.000Z')
  throws(() => cacheTime('2026-10-01T20:10:00'))
  throws(() => cacheOf([], [], { from: at, until: at }))
})

test('cache provenance separates compaction, native and imported observations', () => {
  let native = request(
    'native',
    { input_tokens: 100, cached_tokens: 10 },
    at,
    'n',
  )
  let compact = request(
    'compact',
    { input_tokens: 100, cached_tokens: 50 },
    at,
    'x',
  )
  let imported: Bundle = {
    entity: { eid: 'imported' },
    entry: { session: 'i' },
    usage: { input_tokens: 100, cached_tokens: 20 },
  }
  let r = cacheOf([native, compact, imported, native], [
    { entity: { eid: 'n' }, session: {} },
    { entity: { eid: 'x' }, session: { source: 'cx' } },
    { entity: { eid: 'cx' }, call: { to: 'tx' } },
    { entity: { eid: 'tx' }, tool: { name: 'session_compact' } },
  ], { requests: true })
  equal(r.total.requests, 3)
  equal(r.requests?.map((r) => [r.request, r.path]), [
    ['imported', 'imported'],
    ['compact', 'compaction'],
    ['native', 'native'],
  ])
  equal(r.groups.provider.find((g) => g.key == 'unknown')?.requests, 1)
})

test('cache graph reader and command return the same range without writing', async () => {
  let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, {
    $defs: {
      created: {
        component: true,
        type: 'object',
        properties: { at: { type: 'string', format: 'date-time' } },
      },
      build: { component: true, type: 'object' },
    },
  }])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([
    ...metadata,
    { entity: { eid: tool }, tool: { name: 'test' } },
    ...samples().map((b, seq) => ({
      ...b,
      entry: { session: 's', seq: seq + 1 },
    })),
    {
      ...request(
        'before',
        { input_tokens: 100, cached_tokens: 0 },
        '2026-10-01T20:00:00Z',
      ),
      entry: { session: 's', seq: 6 },
    },
    {
      entity: { eid: 'irrelevant' },
      entry: { session: 's', seq: 7 },
      created: { at },
      content: { body: 'not a request' },
    },
  ])
  let opts = { from: at, requests: true }
  let report = await cacheRead(g, opts)
  equal(report, cacheOf(samples(), metadata, opts))
  let before = await g.read('.entity *')
  let [answer] = await runs({ vocab }).session_cache!({
    entity: { eid: 'command' },
    call: { args: opts },
  }, g)
  equal(
    JSON.parse(String((answer.content as Record<string, unknown>).body)),
    report,
  )
  equal((answer.output as Record<string, unknown>).value, report)
  equal(await g.read('.entity *'), before)
})

test('cache path uses a compact call name without a registry and labels other sources', () => {
  let rows = [request('compact', {}, at, 'x'), request('other', {}, at, 'o')]
  let r = cacheOf(rows, [
    { entity: { eid: 'x' }, session: { source: 'cx' } },
    {
      entity: { eid: 'cx' },
      call: { name: 'session_compact', source: 'parent-ask' },
    },
    { entity: { eid: 'o' }, session: { source: 'unknown-call' } },
  ], { requests: true })
  equal(r.requests?.map((r) => r.path), ['compaction', 'other'])
})

test('an endpoint reporting cache null is unknown, not a cache miss', () => {
  let row: Bundle = {
    entity: { eid: 'workers-ai-ask' },
    entry: { session: 'app-session' },
    ask: { to: '@cf/zai-org/glm-5.3-flash' },
    using: { model: '@cf/zai-org/glm-5.3-flash' },
    usage: { input_tokens: 2822, output_tokens: 38, cached_tokens: null },
  }
  let r = cacheOf([row], [], { requests: true })
  equal(r.total.unknown_cache_requests, 1)
  equal(r.total.unknown_cache_input_tokens, 2822)
  equal(r.total.zero_cache_requests, 0)
  equal(r.total.cached_share, null)
  equal(r.requests?.[0].cached_tokens, null)
})
