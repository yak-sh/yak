import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Model, Request } from '@yaks/model'
import { seed } from './agent.ts'
import { local } from './local.ts'
import { identityEid } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { open } from './store.ts'
import { sessionTools, usingBefore } from '@yaks/session'
import { repo } from './testing.ts'

const M = (name: string) => identityEid('model', [name])

Deno.test('model selection derives provider, does not ask, and applies only to selected session', async () => {
  const h = open(':memory:')
  const seen: [string, Request][] = []
  const fake = (provider: string): Model => (request) => {
    seen.push([provider, request])
    return Promise.resolve({
      id: 'r' + seen.length,
      model: request.model,
      items: [{ kind: 'assistant', text: 'ok' }],
    })
  }
  const a = local({
    cwd: repo(),
    h,
    providers: { openai: fake('openai'), openrouter: fake('openrouter') },
  })
  try {
    await h.g.apply(seed({ provider: 'openrouter', model: 'vendor/model' }))
    const model = M('vendor/model')
    const first = await a.start('first', { model })
    await a.idle(first)
    const other = await a.start('other')
    await a.idle(other)
    assertEquals(seen.map(([p]) => p), ['openrouter', 'openai'])
    await a.selectModel(other, model)
    await a.idle(other)
    assertEquals(seen.length, 2)
    assertEquals(
      (await a.models(other)).current,
      edgeEid(identityEid('provider', ['openrouter']), 'serves', model),
    )
    await a.send(other, 'next')
    await a.idle(other)
    assertEquals(seen.map(([p]) => p), ['openrouter', 'openai', 'openrouter'])
    assertEquals(seen[2][1].anchor, undefined)
    assert(seen[2][1].items.some((i) => i.kind == 'user' && i.text == 'other'))
    await assertRejects(
      () => a.selectModel(other, crypto.randomUUID()),
      Error,
      'Unknown model',
    )
    await assertRejects(
      () => a.selectModel(crypto.randomUUID(), model),
      Error,
      'Unknown session',
    )
  } finally {
    await a.close()
  }
})

Deno.test('inflight model is unchanged; a passive selection survives its completion and later ask', async () => {
  const h = open(':memory:')
  let release!: () => void, started!: () => void
  const begun = new Promise<void>((resolve) => started = resolve)
  const held = new Promise<void>((resolve) => release = resolve)
  const seen: string[] = []
  const a = local({
    cwd: repo(),
    h,
    providers: {
      openai: async (req) => {
        seen.push(req.model)
        started()
        await held
        return {
          id: 'old',
          model: req.model,
          items: [{ kind: 'assistant', text: 'old response' }],
        }
      },
      openrouter: (req) => {
        seen.push(req.model)
        return Promise.resolve({
          id: 'new',
          model: req.model,
          items: [{ kind: 'assistant', text: 'new response' }],
        })
      },
    },
  })
  try {
    await h.g.apply(seed({ provider: 'openrouter', model: 'vendor/new' }))
    const session = await a.start('initial')
    await begun
    const model = M('vendor/new')
    await a.selectModel(session, model)
    assertEquals(seen.length, 1)
    release()
    await a.idle(session)
    assertEquals(seen.length, 1)
    assertEquals(usingBefore(await a.transcript(session))?.model, model)
    await a.send(session, 'continue')
    await a.idle(session)
    assertEquals(seen.at(-1), 'vendor/new')
  } finally {
    release()
    await a.close()
  }
})

Deno.test('passive model controls do not add invented user text to the next request', async () => {
  const seen: Request[] = []
  const h = open(':memory:')
  const a = local({
    cwd: repo(),
    h,
    model: (req) => {
      seen.push(req)
      return Promise.resolve({
        id: 'r',
        model: req.model,
        items: [{ kind: 'assistant', text: 'ok' }],
      })
    },
  })
  try {
    const s = await a.start('first')
    await a.idle(s)
    await h.g.apply(seed({ provider: 'openrouter', model: 'another/model' }))
    await a.selectModel(s, M('another/model'))
    await a.send(s, 'second')
    await a.idle(s)
    assertEquals(
      seen[1].items.filter((i) => i.kind == 'user').map((i) => i.text),
      ['first', 'second'],
    )
  } finally {
    await a.close()
  }
})

Deno.test('late nonstream ask does not override an explicitly selected model', async () => {
  const h = open(':memory:')
  let release!: () => void, started!: () => void
  const begun = new Promise<void>((r) => started = r)
  const held = new Promise<void>((r) => release = r)
  const a = local({
    cwd: repo(),
    h,
    streaming: false,
    model: async (req) => {
      started()
      await held
      return {
        id: 'old',
        model: req.model,
        items: [{ kind: 'assistant', text: 'ok' }],
      }
    },
  })
  try {
    await h.g.apply(seed({ provider: 'openrouter', model: 'next/model' }))
    const s = await a.start('start')
    await begun
    const chosen = M('next/model')
    await a.selectModel(s, chosen)
    release()
    await a.idle(s)
    const entries = await a.transcript(s)
    assertEquals(usingBefore(entries)?.model, chosen)
    const fork = sessionTools(h.g).find((t) => t.name == 'fork')!
    const call = {
      entity: { eid: crypto.randomUUID() },
      call: {},
      entry: { session: s },
      notice: {},
    }
    await h.g.apply([call])
    const child = await fork.run({ prompt: 'fork assignment' }, {
      session: s,
      entries,
      call,
    })
    await a.idle(String(child))
    assertEquals(usingBefore(await a.transcript(String(child)))?.model, chosen)
  } finally {
    release()
    await a.close()
  }
})
