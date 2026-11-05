// A transcript keeps the instructions its newest ask sent while the prefix
// that ask cached lasts in the provider's prompt cache; once it has expired, a
// changed context is sent and the conversation is replayed on it.
import { equal, test } from '@yaks/testing'
import { prefixCacheMark, type Reply, type Request } from '@yaks/model'
import { agent, begin } from './agent.ts'
import { harness } from './testing.ts'

// Two turns, the context changing between them, on a provider whose cache
// lasts `retention` seconds from each request, or that says when it expires.
let turns = async (retention?: number, expires?: string) => {
  let h = await harness()
  let asked: Request[] = []
  let said = 'Two apps.'
  let model = Object.assign(
    (req: Request): Promise<Reply> => {
      asked.push(req)
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: 'fake',
        items: [{ kind: 'assistant', text: 'ok' }],
        ...expires ? { cacheExpiresAt: expires } : {},
      })
    },
    {
      mark: (reply: Reply, cache?: { requestedAt: number }) => ({
        openai: {
          response_id: reply.id,
          ...prefixCacheMark(reply, cache && { ...cache, retention }),
        },
      }),
    },
  )
  let a = agent({
    h,
    name: 'fake',
    model,
    instructions: () => Promise.resolve(said),
  })
  let session = await begin(h.g, 'hello', { using: { model: a.model } })
  await a.idle(session)
  said = 'Three apps.'
  await a.send(session, 'again')
  await a.idle(session)
  await a.close()
  return asked.map((r) => ({
    told: r.instructions,
    // Each input's words, below whatever the host says of when it came.
    said: r.items.flatMap((i) =>
      i.kind == 'user' ? [i.text.split('\n').at(-1)] : []
    ),
  }))
}

test('while the cached prefix lasts, a changed context waits', async () => {
  equal((await turns(300)).map((r) => r.told), ['Two apps.', 'Two apps.'])
})

test('once the cached prefix has expired, the changed context is the prefix and the conversation is replayed on it', async () => {
  equal((await turns(300, '2026-01-01T00:00:00Z')).at(-1), {
    told: 'Three apps.',
    said: ['hello', 'again'],
  })
})

test('a provider that does not say how long its cache lasts is sent the context as it reads now', async () => {
  equal((await turns()).map((r) => r.told), ['Two apps.', 'Three apps.'])
})
