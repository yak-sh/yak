import { test } from '@yaks/testing'
import type { Comp } from '@yaks/graph'
import { assertEquals } from '@std/assert'
import { streamingEnabled } from './streaming.ts'
import { local } from './local.ts'
import { harness } from './testing.ts'

test('streaming defaults on; explicit options override the environment', () => {
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

// The environment with HARNESS_STREAM as given, read without ever setting the
// variable this process shares with every other test file.
const streamAs = (value: string | undefined) => (name: string) =>
  name == 'HARNESS_STREAM' ? value : Deno.env.get(name)

test('local streaming options control the model text callback', async () => {
  for (
    const [options, expected] of [
      [{}, true],
      [{ stream: false }, false],
      [{ streaming: false }, false],
    ] as const
  ) {
    const h = await harness()
    let observed = false
    const a = local({
      h,
      env: streamAs(undefined),
      ...options,
      model: (req) => {
        observed = req.onText != null
        return Promise.resolve({
          id: 'reply',
          model: 'fake',
          items: [{ kind: 'assistant' as const, text: 'done' }],
        })
      },
    })
    try {
      const id = await a.start('hello')
      await a.idle(id)
      assertEquals(observed, expected)
      assertEquals(
        ((await a.transcript(id)).at(-1)?.content as Comp)?.body,
        'done',
      )
    } finally {
      await a.close()
    }
  }
  let calls = 0
  const failed = local({
    h: await harness(),
    env: streamAs(undefined),
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
})
