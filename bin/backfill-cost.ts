#!/usr/bin/env -S deno run -A
// One-time (T-45549): what the sessions already in the graph cost.
//
// - Each model the graph's requests were served by gets its list `price`, in
//   dollars per million tokens, as OpenRouter's catalogue listed it on
//   2026-09-29 (https://openrouter.ai/api/v1/models). The Lyria rows are left
//   unpriced: they are billed per song, not per token.
// - Claude Code runs imported before Claude's cache reads counted as input
//   (packages/session/readers.ts) have them added to `input_tokens`. The cache
//   writes those runs made were never kept, so they stay uncounted.
// - Every entry with `usage` and no `cost` whose model has a price gets
//   `cost{dollars, reported: false}`, weighed as @yaks/session's `weighing`
//   weighs a new one.
//
//   deno run -A bin/backfill-cost.ts <config> [--write]

import type { Bundle, Comp } from '@yaks/graph'
import { identityEid } from '@yaks/graph'
import { type Price, type Usage, weigh } from '@yaks/model'
import { close, opened, signer } from '../packages/cli/local.ts'

let PRICES: Record<string, Price> = {
  'gpt-6-sol': { input: 2, output: 10, cached: 0.2 },
  'gpt-6-astra': { input: 10, output: 50, cached: 1 },
  'gpt-5.6-sol': { input: 2, output: 10, cached: 0.2 },
  'gpt-5.6-terra': { input: 2, output: 12, cached: 0.2 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cached: 0.02 },
  'z-ai/glm-5.3-flash': { input: 0.15, output: 0.5, cached: 0.03 },
  'z-ai/glm-5.3': { input: 1.4, output: 4.4, cached: 0.26 },
  'deepseek/deepseek-v4.1-flash': { input: 0.3, output: 1.2, cached: 0.006 },
  'deepseek/deepseek-v4-flash-0731': {
    input: 0.018,
    output: 0.32,
    cached: 0.018,
  },
  'x-ai/grok-4.6': { input: 2, output: 6, cached: 0.5 },
}

let [path, flag] = Deno.args
let write = flag == '--write'
let host = await opened(path, ['graph'])
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let priced = Object.entries(PRICES).map(([name, price]): Bundle => ({
  entity: { eid: identityEid('model', [name]) },
  price,
}))
let rows = await g.get(priced.map((b) => b.entity.eid), ['model'])
let known = new Set(rows.filter((b) => b.model).map((b) => b.entity.eid))
let prices = new Map(
  priced.filter((b) => known.has(b.entity.eid))
    .map((b) => [b.entity.eid, b.price as Price]),
)
console.log(`${prices.size} of ${priced.length} priced models are rows`)

// The sessions a Claude Code run was read into: their request asks `claude`.
let claude = identityEid('provider', ['claude'])
let runs = new Set(
  (await g.read(`.using.provider=${claude}&?entry`))
    .map((b) => String(comp(b, 'entry')?.session)),
)

let owed = await g.read('.usage&!cost&?entry&?ask&?using')
let fixed: Bundle[] = []
let costs: Bundle[] = []
let spent = new Map<string, { n: number; dollars: number }>()
for (let b of owed) {
  let usage = { ...comp(b, 'usage') } as Usage
  if (runs.has(String(comp(b, 'entry')?.session)) && usage.cached_tokens) {
    let input = (usage.input_tokens ?? 0) + usage.cached_tokens
    fixed.push({
      entity: b.entity,
      usage: { input_tokens: input },
      ...as,
    })
    usage.input_tokens = input
  }
  let model = String(comp(b, 'ask')?.to ?? comp(b, 'using')?.model ?? '')
  let price = prices.get(model)
  if (!price) continue
  let dollars = weigh(price, usage)
  costs.push({
    entity: b.entity,
    cost: { dollars, reported: false },
    ...as,
  })
  let t = spent.get(model) ?? { n: 0, dollars: 0 }
  spent.set(model, { n: t.n + 1, dollars: t.dollars + dollars })
}
console.log(`${owed.length} requests carry usage and no cost`)
console.log(`${fixed.length} Claude Code usages count their cache reads`)
console.log(`${costs.length} weighed:`)
let names = new Map(
  priced.map((b, i) => [b.entity.eid, Object.keys(PRICES)[i]]),
)
for (let [model, t] of spent) {
  console.log(
    `  ${names.get(model)}: ${t.n} requests, $${t.dollars.toFixed(2)}`,
  )
}
if (!write) {
  await close(0)
  Deno.exit(0)
}

await g.apply(
  priced.filter((b) => known.has(b.entity.eid)).map((b) => ({
    ...b,
    ...as,
  })),
)
// The usage first: a cost weighed from it lands on the corrected counts.
if (fixed.length) await g.apply(fixed)
for (let i = 0; i < costs.length; i += 500) {
  await g.apply(costs.slice(i, i + 500))
}
let left = (await g.read('.usage&!cost')).length
console.log(`applied; ${left} requests remain unweighed`)
await close(0)
