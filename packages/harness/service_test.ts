import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { maintaining, service } from './service.ts'
import { compose } from '@yaks/cli/host'
import { at } from './testing.ts'

test('maintenance repeats without a restart, retries failures, and drains on stop', async () => {
  let stop = new AbortController()
  let calls: string[] = []
  let attempt = 0
  await maintaining(
    [
      () => {
        calls.push('check')
        if (++attempt == 1) return Promise.reject(new Error('probe failed'))
        stop.abort()
        return Promise.resolve()
      },
      async () => {
        await Promise.resolve()
        calls.push('sweep')
      },
    ],
    async (error) => {
      await Promise.resolve()
      calls.push((error as Error).message)
    },
    stop.signal,
    1,
  )
  assertEquals(calls, ['check', 'probe failed', 'sweep', 'check', 'sweep'])
})

test('maintenance runs one pass for an aborted signal', async () => {
  let passes = 0
  await maintaining(
    [() => Promise.resolve(void passes++)],
    () => {},
    AbortSignal.abort(),
  )
  assertEquals(passes, 1)
})

test('a service over another graph leaves the live machine alone', async () => {
  let host = await compose(at(), ['graph'])
  try {
    await service(host)
    assertEquals(await host.graph.read('.exception'), [])
  } finally {
    await host.close()
  }
})
