// The chat's first write is one atomic move: retire the selected binding,
// spawn the replacement Session on the first prompt, and bind it.
import '../testing.ts'
import { assertEquals, assertThrows } from '@std/assert'
import { h } from 'preact'
import { cache, ent, useRoute } from '../live.ts'
import { mount } from './mount.ts'
import { chatChanges, chatPlan, ReferenceList, Starter } from './Chat.tsx'

// A mounted view holds subscriptions. In a test there is no server to hold
// them against, so control frames go nowhere through live.ts's transport
// seam — the cache here is only ever what the test seeds.
useRoute(() => {})

Deno.test('chatChanges spawns a taskless session and rebinds the chat', () => {
  let got = chatChanges(
    'old',
    'next',
    'actor',
    'target',
    { provider: 'p', model: 'm' },
    'What changed?',
  )
  let entry = got.find((c) => c.name == 'entry')!.eid
  assertEquals(got, [
    { eid: 'old', name: 'chat', comp: null },
    { eid: 'next', name: 'session', comp: {} },
    { eid: entry, name: 'entry', comp: { session: 'next' } },
    { eid: entry, name: 'content', comp: { body: 'What changed?' } },
    { eid: entry, name: 'using', comp: { provider: 'p', model: 'm' } },
    { eid: 'next', name: 'chat', comp: { actor: 'actor', target: 'target' } },
  ])
})

Deno.test('chatPlan picks a graph-native provider', () => {
  let ps = [
    {
      name: 'codex',
      models: ['gpt'],
      labels: { gpt: 'GPT' },
      efforts: { gpt: ['low', 'medium'] },
    },
    { name: 'codex-cli', models: ['gpt'], fallback: true },
  ]
  assertEquals(chatPlan(ps, () => false), {
    provider: 'codex',
    model: 'gpt',
    effort: 'medium',
  })
  assertThrows(
    () => chatPlan(ps, (name) => name == 'codex'),
    Error,
    'No graph-native chat model is available',
  )
})

Deno.test('chat references mount the entity List.Tile renderer', () => {
  cache.value = {
    target: {
      entity: { eid: 'target', num: 7 },
      doc: { eid: 'target', title: 'A target', body: '' },
      task: { eid: 'target' },
      filed: { eid: 'target', priority: 0 },
    },
  }
  let mounted = mount(
    h(ReferenceList, { label: 'referenced by', items: [{ eid: 'target' }] }),
  )
  try {
    assertEquals(
      mounted.root.querySelector('.List_Row > .Tile-task .Tile_Title')
        ?.textContent,
      'A target',
    )
    assertEquals(mounted.root.querySelector('.Chat_Link'), null)
  } finally {
    mounted.free()
    cache.value = {}
  }
})

Deno.test('a new chat reuses the composer input with a terse prompt', () => {
  cache.value = {
    target: {
      entity: { eid: 'target', num: 7 },
      doc: { eid: 'target', title: 'A very long document title', body: '' },
    },
  }
  let mounted = mount(
    h(Starter, { e: ent('target'), actor: 'actor', done() {} }),
  )
  try {
    let box = mounted.root.querySelector('.Comments_New')
    assertEquals(box?.getAttribute('placeholder'), 'start a chat…')
    assertEquals(box?.getAttribute('class'), 'Comments_New')
  } finally {
    mounted.free()
    cache.value = {}
  }
})

// T-37445: the referencing sessions ride the citation answer as peers, so the
// held list opens no rows sub of its own; an unheld list still does.
Deno.test('a held reference list asks for no rows of its own', async () => {
  let sent: Record<string, unknown>[] = []
  let prior = useRoute((f) => sent.push(f as Record<string, unknown>))
  let peer = 'c0000000-0000-4000-8000-000000000001'
  let cited = 'c0000000-0000-4000-8000-000000000002'
  let held = mount(
    h(ReferenceList, {
      label: 'referenced by',
      items: [{ eid: peer }],
      held: true,
    }),
  )
  let asked = mount(
    h(ReferenceList, { label: 'references', items: [{ eid: cited }] }),
  )
  try {
    await Promise.resolve()
    let lines = sent.map((f) => f.subscribe)
    assertEquals(lines.includes(`.eid=${cited}`), true)
    assertEquals(lines.some((l) => String(l).includes(peer)), false)
  } finally {
    asked.free()
    held.free()
    useRoute(prior)
  }
})
