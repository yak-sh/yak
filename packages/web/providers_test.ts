// One model catalog, one transport rule: present each compatible model once
// and route it graph-native → CLI fallback by readiness, independent of
// provider-table order.
import './testing.ts'
import { assertEquals, assertThrows } from '@std/assert'
import {
  catalog,
  offer,
  type Provider,
  spawnDefault,
  tableOf,
  transport,
  usingOf,
} from './providers.ts'

// The shipped shape: graph-native `codex` carries the menu; the `codex-cli`
// fallback shares its models but offers no label of its own.
let codex: Provider = {
  name: 'codex',
  models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
  efforts: { 'gpt-5.6-sol': ['low', 'high'], 'gpt-5.6-terra': ['low', 'high'] },
  labels: { 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra' },
}
let codexCli: Provider = {
  name: 'codex-cli',
  models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
  labels: {},
  fallback: true,
}
let claude: Provider = {
  name: 'claude',
  models: ['claude-opus-4-8', 'sonnet'],
  labels: { 'claude-opus-4-8': 'Opus', sonnet: 'Sonnet' },
}

Deno.test('catalog offers each model once, Sol first, fallback as a transport', () => {
  let cat = catalog([codex, codexCli, claude])
  // Two Codex models + two Claude models, never the fallback's clone.
  assertEquals(cat.map((c) => c.label), [
    'GPT-5.6 Sol',
    'GPT-5.6 Terra',
    'Opus',
    'Sonnet',
  ])
  let sol = cat[0]
  // Graph-native transport leads; the CLI fallback trails.
  assertEquals(sol.transports, ['codex', 'codex-cli'])
  assertEquals(sol.efforts, ['low', 'high'])
  // Claude has one transport and no fallback.
  assertEquals(cat.find((c) => c.model == 'sonnet')?.transports, ['claude'])
})

Deno.test('catalog ranks the graph-native transport first regardless of table order', () => {
  let sol = catalog([codexCli, codex])[0]
  assertEquals(sol.transports, ['codex', 'codex-cli'])
})

Deno.test('offer resolves explicit model and transport combinations', () => {
  let picks = catalog([codex, codexCli, claude])
  assertEquals(offer(picks)?.model, 'gpt-5.6-sol')
  assertEquals(offer(picks, { provider: 'claude' })?.model, 'claude-opus-4-8')
  assertEquals(offer(picks, { model: 'gpt-5.6-terra' })?.model, 'gpt-5.6-terra')
  assertEquals(
    offer(picks, { provider: 'claude', model: 'gpt-5.6-sol' }),
    undefined,
  )
})

Deno.test('transport picks graph-native when ready, the fallback when blocked', () => {
  let sol = catalog([codex, codexCli])[0]
  assertEquals(transport(sol, () => false), 'codex')
  assertEquals(
    transport(sol, (name) => name == 'codex'),
    'codex-cli',
  )
  // Both blocked degrades to the last-resort fallback, not to nothing.
  assertEquals(transport(sol, () => true), 'codex-cli')
})

Deno.test('spawnDefault promotes Sol and degrades to the first provider', () => {
  assertEquals(
    spawnDefault([
      { name: 'claude', models: ['opus'] },
      { name: 'codex', models: ['gpt-5.6-sol', 'terra'] },
    ]),
    { provider: 'codex', model: 'gpt-5.6-sol' },
  )
  assertEquals(spawnDefault([{ name: 'one', models: ['a', 'b'] }]), {
    provider: 'one',
    model: 'a',
  })
  assertEquals(
    spawnDefault([
      { name: 'claude', models: ['opus'] },
      { name: 'codex', models: ['gpt-5.6-sol'] },
    ], { provider: 'claude' }),
    { provider: 'claude', model: 'opus' },
  )
  assertEquals(spawnDefault([]), { provider: undefined, model: undefined })
})

Deno.test('spawnDefault routes the default model by readiness', () => {
  // Signed in: the default Sol runs graph-native.
  assertEquals(
    spawnDefault([codex, codexCli], {}, () => false),
    { provider: 'codex', model: 'gpt-5.6-sol' },
  )
  // Not signed in: the same model routes to the CLI fallback, never a husk.
  assertEquals(
    spawnDefault([codex, codexCli], {}, (name) => name == 'codex'),
    { provider: 'codex-cli', model: 'gpt-5.6-sol' },
  )
})

// Graph rows as @yaks/model writes them: a provider, a model, and the
// `serves` edge from one to the other.
let row = (eid: string, comps: Record<string, unknown>) => ({
  entity: { eid },
  ...comps,
})
let serves = (from: string, to: string) =>
  row(`${from}>${to}`, { edge: { from, to }, serves: {} })
let rows = [
  row('p1', { provider: { name: 'codex', offered: true } }),
  row('p2', { provider: { name: 'codex-cli', offered: true, fallback: true } }),
  row('p3', { provider: { name: 'fake', offered: false } }),
  row('m1', {
    model: {
      name: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      offered: true,
      efforts: 'low high',
      effort: 'high',
    },
  }),
  row('m2', { model: { name: 'fake-fast', label: 'Fake', offered: true } }),
  row('m3', { model: { name: 'old', label: 'Old', offered: false } }),
  serves('p1', 'm1'),
  serves('p1', 'm3'),
  serves('p2', 'm1'),
  serves('p3', 'm2'),
]

Deno.test('tableOf reads the offered providers and the models they serve', () => {
  let t = tableOf(rows)
  assertEquals(t.map((p) => p.name), ['codex', 'codex-cli'])
  assertEquals(t[0], {
    name: 'codex',
    eid: 'p1',
    eids: { 'gpt-5.6-sol': 'm1', old: 'm3' },
    models: ['gpt-5.6-sol', 'old'],
    labels: { 'gpt-5.6-sol': 'GPT-5.6 Sol' },
    efforts: { 'gpt-5.6-sol': ['low', 'high'] },
    defaults: { 'gpt-5.6-sol': 'high' },
  })
  assertEquals(t[1].fallback, true)
  assertEquals(catalog(t).map((c) => [c.model, c.transports]), [
    ['gpt-5.6-sol', ['codex', 'codex-cli']],
  ])
})

Deno.test('usingOf names the provider and model entities, or refuses', () => {
  let t = tableOf(rows)
  assertEquals(
    usingOf(t, { provider: 'codex', model: 'gpt-5.6-sol', effort: 'low' }),
    { provider: 'p1', model: 'm1', effort: 'low' },
  )
  assertEquals(usingOf(t, { provider: 'codex-cli' }), { provider: 'p2' })
  assertThrows(() => usingOf(t, { provider: 'fake' }))
  assertThrows(() => usingOf(t, { provider: 'codex-cli', model: 'old' }))
})
