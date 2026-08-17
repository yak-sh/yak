// The usage projection as a pure seam: normalization at the adapter, the
// absent-beats-zero law surviving every roll, and cost/throughput off the
// folded totals. The fixtures are the two providers' real usage shapes.
import { assertEquals } from '@std/assert'
import { anthropicUsage, codexUsage } from './adapters.ts'
import type { Session } from './types.ts'
import {
  cost,
  costOf,
  group,
  hitRate,
  roll,
  tokS,
  usd,
  use,
  wall,
} from './usage.ts'

let sess = (o: Partial<Session>): Session => ({ eid: 'e', id: 'S-1', ...o })

Deno.test('anthropic: tiers rename, no arithmetic', () => {
  assertEquals(
    anthropicUsage({
      input_tokens: 100,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
      output_tokens: 200,
    }),
    { input: 100, cache_read: 40, cache_creation: 10, output: 200 },
  )
})

Deno.test('codex: input includes cached, so fresh input subtracts it', () => {
  assertEquals(
    codexUsage({
      input_tokens: 1000,
      cached_input_tokens: 600,
      output_tokens: 5,
    }),
    { input: 400, cache_read: 600, output: 5 },
  )
  // no cached field: input is left whole, cache_read stays absent
  assertEquals(codexUsage({ input_tokens: 1000, output_tokens: 5 }), {
    input: 1000,
    output: 5,
  })
})

Deno.test('absent beats zero: an unreported tier stays OFF the object', () => {
  // a session that reported only output has no input key at all
  let u = anthropicUsage({ output_tokens: 34 })
  assertEquals(u, { output: 34 })
  assertEquals('input' in u!, false)
  // a reported zero is NOT absent — it stays 0
  assertEquals(anthropicUsage({ input_tokens: 0, output_tokens: 34 }), {
    input: 0,
    output: 34,
  })
  // an empty blob normalizes to null, not a bag of zeros
  assertEquals(anthropicUsage({}), null)
})

Deno.test('use: null when nothing to read; Use carries the dimensions', () => {
  assertEquals(use(sess({})), null) // no blob
  assertEquals(use(sess({ usage_json: '{"output_tokens":5}' })), null) // no provider
  assertEquals(use(sess({ provider: 'nope', usage_json: '{}' })), null) // unknown
  assertEquals(
    use(sess({
      id: 'S-9',
      provider: 'claude',
      serving_model: 'claude-opus-4-8',
      persona: 'N-1',
      requested_task: 'T-7',
      usage_json: '{"input_tokens":100,"output_tokens":50}',
    })),
    {
      session: 'S-9',
      provider: 'claude',
      model: 'claude-opus-4-8',
      persona: 'N-1',
      task: 'T-7',
      usage: { input: 100, output: 50 },
    },
  )
})

Deno.test('wall: elapsed ms, or absent when nonsensical', () => {
  assertEquals(wall('2026-08-15T00:00:00Z', '2026-08-15T00:00:02Z'), 2000)
  assertEquals(wall(null, '2026-08-15T00:00:02Z'), undefined)
  assertEquals(wall('2026-08-15T00:00:05Z', '2026-08-15T00:00:02Z'), undefined)
})

Deno.test('roll: each facet carries its own n across mixed reporting', () => {
  let a = use(sess({
    provider: 'claude',
    model: 'x',
    usage_json: '{"input_tokens":100,"output_tokens":50}',
  }))!
  let b = use(sess({
    provider: 'claude',
    model: 'x',
    usage_json: '{"output_tokens":10}', // reported no input
  }))!
  let r = roll([a, b])
  assertEquals(r.n, 2)
  assertEquals(r.output, { total: 60, n: 2 })
  assertEquals(r.input, { total: 100, n: 1 }) // only one reported input
  assertEquals(r.cache_read, undefined) // neither did — facet stays absent
  assertEquals(roll([]).n, 0)
})

Deno.test('group: a missing key drops the row, never a bogus bucket', () => {
  let a = use(
    sess({
      provider: 'claude',
      persona: 'N-1',
      usage_json: '{"output_tokens":1}',
    }),
  )!
  let b = use(sess({ provider: 'claude', usage_json: '{"output_tokens":1}' }))!
  let g = group([a, b], (u) => u.persona)
  assertEquals([...g.keys()], ['N-1'])
  assertEquals(g.get('N-1')!.length, 1)
})

Deno.test('tokS and hitRate off wall-clock and cache tiers', () => {
  let r = roll([{
    session: 'S-1',
    usage: { input: 100, cache_read: 300, output: 2000 },
    ms: 4000,
  }])
  assertEquals(tokS(r), 500) // 2000 output / 4s
  assertEquals(hitRate(r), 300 / 400) // reads / (reads + fresh input)
  // no wall-clock → no throughput; no cache reads → no hit rate
  assertEquals(
    tokS(roll([{ session: 'S-2', usage: { output: 5 } }])),
    undefined,
  )
  assertEquals(
    hitRate(roll([{ session: 'S-2', usage: { output: 5 } }])),
    undefined,
  )
})

Deno.test('cost: priced models bill, unpriced ones stay absent', () => {
  // opus: 100*5 + 50*25 + 200*0.5(cache read) = 500 + 1250 + 100 = 1850 µUSD
  let opus = {
    session: 'S-1',
    model: 'claude-opus-4-8',
    usage: { input: 100, cache_read: 200, output: 50 },
  }
  assertEquals(costOf(opus), 1850)
  // a codex/gpt model is not priced — absent cost, never $0
  assertEquals(
    costOf({ session: 'S-2', model: 'gpt-5.6-sol', usage: { output: 999 } }),
    undefined,
  )
  // total counts only the priced sessions in n
  let c = cost([opus, {
    session: 'S-2',
    model: 'gpt-5.6-sol',
    usage: { output: 999 },
  }])
  assertEquals(c, { total: 1850, n: 1 })
})

Deno.test('usd: dollars, with sub-cent precision so cheap != free', () => {
  assertEquals(usd(1_850_000), '$1.85')
  assertEquals(usd(5000), '$0.0050')
  assertEquals(usd(0), '$0.00')
})
