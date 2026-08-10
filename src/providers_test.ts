// Anonymous spawn selection is one rule, independent of provider-table order.
import { assertEquals } from '@std/assert'
import { spawnDefault } from './providers.ts'

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
