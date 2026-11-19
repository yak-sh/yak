// The list prices and labels a graph gives a model the first time it meets one
// (packages/model/prices.json, read by @yaks/model `listPrice` and
// `listLabel`), from
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

// A listing's Anthropic and OpenAI models, each by its transcripts' name.
let named = (listed: Listed[]): [string, string, Listed][] =>
  listed.flatMap((l): [string, string, Listed][] => {
    let [, vendor, name] = l.name.match(VENDOR) ?? []
    if (!vendor) return []
    return [[
      vendor,
      vendor == 'anthropic' ? name.replaceAll('.', '-') : name,
      l,
    ]]
  }).sort(([, a], [, b]) => a < b ? -1 : 1)

/** A listing's Anthropic and OpenAI models' prices, by their transcripts'
 * names. */
export let prices = (listed: Listed[]): Record<string, Price> =>
  Object.fromEntries(
    named(listed).flatMap(([vendor, name, l]): [string, Price][] =>
      !l.price
        ? []
        : vendor == 'anthropic'
        ? [[name, { ...l.price, cache_write_1h: l.price.input * 2 }]]
        : [[name, l.price]]
    ),
  )

/** What a person sees each of a listing's Anthropic and OpenAI models
 * called, by their transcripts' names: OpenRouter's name for it without its
 * vendor, and Claude's models without "Claude" ("Sonnet 5.5"). */
export let labels = (listed: Listed[]): Record<string, string> =>
  Object.fromEntries(
    named(listed).flatMap(([, name, l]): [string, string][] =>
      l.label
        ? [[name, l.label.replace(/^[^:]*:\s*/, '').replace(/^Claude /, '')]]
        : []
    ),
  )

if (import.meta.main) {
  let out = new URL('../packages/model/prices.json', import.meta.url)
  let listed = await listing()
  let table = {
    source: 'https://openrouter.ai/api/v1/models',
    day: new Date().toISOString().slice(0, 10),
    prices: prices(listed),
    labels: labels(listed),
  }
  await Deno.writeTextFile(out, JSON.stringify(table, null, 2) + '\n')
  console.log(`${Object.keys(table.prices).length} prices → ${out.pathname}`)
}
