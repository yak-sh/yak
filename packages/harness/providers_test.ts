import { assert, assertEquals } from '@std/assert'
import type { Mark, Model, Request } from '@yaks/model'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { toolEid } from '@yaks/tools'
import { agent, seed } from './run.ts'
import { open } from './store.ts'

const P = (name: string) => identityEid('provider', [name])
const M = (name: string) => identityEid('model', [name])
Deno.test('OpenRouter provider uses UUIDs and is selected per session/ask, including switched context', async () => {
  const h = open(':memory:')
  const seen: [string, Request][] = []
  const fake = (provider: string): Model =>
    Object.assign((req: Request) => {
      seen.push([provider, req])
      return Promise.resolve({
        id: provider + seen.length,
        model: req.model,
        items: [{ kind: 'assistant' as const, text: provider }],
      })
    }, {
      mark: (): Mark =>
        provider === 'openai'
          ? { openai: { response_id: 'oa' } }
          : { openrouter: { response_id: 'or' } },
      anchor: (b: Record<string, unknown>) =>
        provider === 'openai' && b.openai ? 'oa' : undefined,
    })
  const a = agent({
    h,
    providers: { openai: fake('openai'), openrouter: fake('openrouter') },
  })
  try {
    await h.g.apply(seed({ provider: 'openrouter', model: 'vendor/model' }))
    const s = await a.start('initial')
    await a.idle(s)
    await h.g.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: s },
      content: { body: 'switch' },
      using: { provider: P('openrouter'), model: M('vendor/model') },
    }])
    await a.idle(s)
    assertEquals(seen.map(([p]) => p), ['openai', 'openrouter'])
    assertEquals(seen[1][1].anchor, undefined)
    assert(
      seen[1][1].items.some((i) => i.kind === 'user' && i.text === 'initial'),
    )
    const transcript = await a.transcript(s)
    assert(transcript.some((b) => b.openrouter))
    await h.g.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: s },
      content: { body: 'mismatch' },
      using: { provider: P('openai'), model: M('vendor/model') },
    }])
    await a.idle(s)
    assertEquals(seen.length, 2)
  } finally {
    await a.close()
  }
})
Deno.test('explicit default provider seeds correctly and custom model override remains usable', async () => {
  const a = agent({
    h: open(':memory:'),
    provider: 'openrouter',
    name: 'vendor/model',
    model: (req) => Promise.resolve({ id: 'r', model: req.model, items: [] }),
  })
  try {
    const s = await a.start('work')
    await a.idle(s)
    const entries = await a.transcript(s)
    assertEquals(
      (entries.find((b) => b.ask)?.ask as { to: string }).to,
      M('vendor/model'),
    )
  } finally {
    await a.close()
  }
})

Deno.test('fork and spawn selecting an existing model are served by a provider that serves it', async () => {
  const h = open(':memory:')
  const seen: string[] = []
  const a = agent({
    h,
    providers: {
      openai: (req) => {
        seen.push('openai')
        return Promise.resolve({
          id: 'oa',
          model: req.model,
          items: [{ kind: 'assistant', text: 'parent' }],
        })
      },
      openrouter: (req) => {
        seen.push('openrouter')
        return Promise.resolve({
          id: 'or',
          model: req.model,
          items: [{ kind: 'assistant', text: 'child' }],
        })
      },
    },
  })
  try {
    await h.g.apply(seed({ provider: 'openrouter', model: 'vendor/child' }))
    const parent = await a.start('parent')
    await a.idle(parent)
    for (const kind of ['fork', 'spawn']) {
      const entries = await a.transcript(parent)
      const tool = a.tools.find((t) => t.name === kind)!
      const eid = crypto.randomUUID()
      await h.g.apply([{
        entity: { eid },
        entry: { session: parent },
        call: { to: toolEid(kind), id: eid, args: '{}' },
      }])
      const child = await tool.run({
        prompt: 'child task',
        model: M('vendor/child'),
      }, { session: parent, entries, call: { entity: { eid } } })
      await a.idle(String(child))
      const input = (await a.transcript(String(child))).find((b) =>
        (b.content as { body?: string })?.body === 'child task'
      )!
      // openai does not serve the child's model, so the provider is left to
      // the one that does
      assertEquals((input.using as Comp).provider, null)
    }
    assertEquals(seen.filter((p) => p == 'openrouter').length, 2)
  } finally {
    await a.close()
  }
})

Deno.test('worker authorization panel offers graph-configured OpenRouter without a model request', async () => {
  const { remote } = await import('./remote.ts')
  const dir = await Deno.makeTempDir()
  const path = dir + '/harness.db'
  const h = open(path)
  await h.g.apply(seed({ provider: 'openrouter', model: 'vendor/model' }))
  h.close()
  const r = await remote({ db: path })
  try {
    const list = await r.agent.authorizeMCP!('list')
    assert(list.servers?.includes('OpenRouter (model provider)'))
    const begun = await r.agent.authorizeMCP!(
      'begin',
      'OpenRouter (model provider)',
    )
    assertEquals(new URL(begun.url!).origin, 'https://openrouter.ai')
    assertEquals(
      new URL(begun.url!).searchParams.get('code_challenge_method'),
      'S256',
    )
    await r.agent.authorizeMCP!('cancel', 'OpenRouter (model provider)')
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('a model two providers serve is asked by the named one, in its spelling', async () => {
  const h = open(':memory:')
  const seen: [string, string][] = []
  const fake = (provider: string): Model => (req) => {
    seen.push([provider, req.model])
    return Promise.resolve({ id: 'r', model: req.model, items: [] })
  }
  const a = agent({
    h,
    providers: { openai: fake('openai'), openrouter: fake('openrouter') },
  })
  const ask = async (using: Comp) => {
    const s = await a.start('go')
    await a.idle(s)
    await h.g.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: s },
      content: { body: 'again' },
      using,
    }])
    await a.idle(s)
  }
  try {
    await h.g.apply([{
      ...link(P('openrouter'), 'serves', M('gpt-6-astra')),
      serves: { name: 'openai/gpt-6-astra' },
    }, { entity: { eid: '$p' }, provider: { name: 'openrouter' } }])
    await ask({ provider: P('openrouter'), model: M('gpt-6-astra') })
    // two reachable providers serve it and none is named: refused, not asked
    await ask({ model: M('gpt-6-astra') })
    assertEquals(seen, [
      ['openai', 'gpt-6-astra'],
      ['openrouter', 'openai/gpt-6-astra'],
      ['openai', 'gpt-6-astra'],
    ])
  } finally {
    await a.close()
  }
})
