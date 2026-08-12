// One model catalog, one transport rule: present each compatible model once
// and route it graph-native → CLI fallback by readiness, independent of
// provider-table order.
import { assertEquals } from '@std/assert'
import { catalog, type Provider, spawnDefault, transport } from './providers.ts'

// The shipped shape: graph-native `codex` carries the menu; the `codex-cli`
// fallback shares its models but offers no label of its own.
let codex: Provider = {
  name: 'codex',
  models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
  efforts: ['low', 'high'],
  labels: { 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra' },
}
let codexCli: Provider = {
  name: 'codex-cli',
  models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
  efforts: ['low', 'high'],
  labels: {},
  fallback: true,
}
let claude: Provider = {
  name: 'claude',
  models: ['claude-opus-4-8', 'sonnet'],
  efforts: [],
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

Deno.test('spawnDefault reads readiness off the table when no blocker is given', () => {
  // The server stamps `ready`; the default blocker routes around a false one.
  let unready: Provider[] = [{ ...codex, ready: false }, {
    ...codexCli,
    ready: true,
  }]
  assertEquals(spawnDefault(unready), {
    provider: 'codex-cli',
    model: 'gpt-5.6-sol',
  })
  let ready: Provider[] = [{ ...codex, ready: true }, {
    ...codexCli,
    ready: true,
  }]
  assertEquals(spawnDefault(ready), { provider: 'codex', model: 'gpt-5.6-sol' })
})
