// The list prices a graph gives a model the first time it meets one
// (packages/model/prices.json, read by @yaks/model `listPrice`), from
// OpenRouter's public listing of Anthropic's and OpenAI's models, under the
// names Claude Code and Codex write in their transcripts: Anthropic's with
// dashes for dots (`claude-opus-4-6`), OpenAI's as listed (`gpt-5.1-codex`).
// OpenRouter lists no hour-long cache write; Anthropic's pricing page sets it
// at twice the input price
// (https://platform.claude.com/docs/en/about-claude/pricing).
//
//   deno run --allow-net=openrouter.ai --allow-write=packages/model bin/prices.ts

import { listing } from '@yaks/openrouter'
import type { Listed, Price } from '@yaks/model'

let VENDOR = /^(anthropic|openai)\/([^:]+)$/

/** A listing's Anthropic and OpenAI models, by their transcripts' names. */
export let prices = (listed: Listed[]): Record<string, Price> =>
  Object.fromEntries(
    listed.flatMap((l): [string, Price][] => {
      let [, vendor, name] = l.name.match(VENDOR) ?? []
      if (!vendor || !l.price) return []
      return vendor == 'anthropic'
        ? [[name.replaceAll('.', '-'), {
          ...l.price,
          cache_write_1h: l.price.input * 2,
        }]]
        : [[name, l.price]]
    }).sort(([a], [b]) => a < b ? -1 : 1),
  )

if (import.meta.main) {
  let out = new URL('../packages/model/prices.json', import.meta.url)
  let table = {
    source: 'https://openrouter.ai/api/v1/models',
    day: new Date().toISOString().slice(0, 10),
    prices: prices(await listing()),
  }
  await Deno.writeTextFile(out, JSON.stringify(table, null, 2) + '\n')
  console.log(`${Object.keys(table.prices).length} prices → ${out.pathname}`)
}
