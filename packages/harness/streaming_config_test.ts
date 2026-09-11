import type { Comp } from '@yaks/graph'
import { assertEquals } from '@std/assert'
import { streamingEnabled } from './streaming.ts'
import { agent } from './run.ts'
import { open } from './store.ts'
import { remote } from './remote.ts'

Deno.test('streaming defaults on; explicit options override the environment', () => {
  for (const value of [undefined, '1', '0']) {
    const env = () => value
    assertEquals(streamingEnabled({}, env), value != '0')
    assertEquals(streamingEnabled({ streaming: false }, env), false)
    assertEquals(streamingEnabled({ stream: false }, env), false)
    assertEquals(streamingEnabled({ streaming: true }, env), true)
    assertEquals(streamingEnabled({ stream: true }, env), true)
    assertEquals(
      streamingEnabled({ streaming: false, stream: true }, env),
      false,
    )
    assertEquals(streamingEnabled({ streaming: undefined }, env), value != '0')
  }
})

Deno.test('default inline streaming admits an ask for a model without deltas; opt-out keeps legacy path', async () => {
  const previous = Deno.env.get('HARNESS_STREAM')
  Deno.env.delete('HARNESS_STREAM')
  try {
    for (const options of [{}, { stream: false }, { streaming: false }]) {
      const h = open(':memory:')
      let observed = false
      const a = agent({
        h,
        ...options,
        model: async () => {
          observed = (await h.g.read('.ask')).length > 0
          return {
            id: 'reply',
            model: 'fake',
            items: [{ kind: 'assistant', text: 'done' }],
          }
        },
      })
      try {
        const id = await a.start('hello')
        await a.idle(id)
        assertEquals(observed, !('stream' in options || 'streaming' in options))
        assertEquals(
          ((await a.transcript(id)).at(-1)?.content as Comp)?.body,
          'done',
        )
      } finally {
        await a.close()
      }
    }
    let calls = 0
    const failed = agent({
      h: open(':memory:'),
      model: () => {
        calls++
        return Promise.reject(new Error('interrupted transport'))
      },
    })
    try {
      const id = await failed.start('fail')
      await failed.idle(id)
      assertEquals(calls, 1)
      const entries = await failed.transcript(id)
      assertEquals(
        (entries.find((b) => b.ask)?.attempt as Comp)?.state,
        'interrupted',
      )
    } finally {
      await failed.close()
    }
  } finally {
    if (previous === undefined) Deno.env.delete('HARNESS_STREAM')
    else Deno.env.set('HARNESS_STREAM', previous)
  }
})

Deno.test('worker resolves streaming environment and explicit opt-out before cloning configuration', async () => {
  const previous = Deno.env.get('HARNESS_STREAM')
  try {
    for (
      const [value, options, expected] of [
        [undefined, {}, true],
        ['0', {}, false],
        ['1', {}, true],
        ['1', { stream: false }, false],
        ['1', { streaming: false }, false],
      ] as const
    ) {
      if (value === undefined) Deno.env.delete('HARNESS_STREAM')
      else Deno.env.set('HARNESS_STREAM', value)
      const a = await remote({ db: ':memory:', fake: true, ...options })
      try {
        const id = await a.agent.start('hello')
        await a.idle(id)
        const entries = await a.agent.transcript(id)
        assertEquals(entries.some((b) => b.attempt), expected)
      } finally {
        await a.close()
      }
    }
  } finally {
    if (previous === undefined) Deno.env.delete('HARNESS_STREAM')
    else Deno.env.set('HARNESS_STREAM', previous)
  }
})
