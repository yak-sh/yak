// The files door (files.ts `door`) over a FILES binding the runtime cuts off.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { door } from './files.ts'
import type { Env } from './env.ts'

// A binding that loses its first `cuts` calls the way the runtime does.
let cutting = (cuts: number) => {
  let sent: string[] = []
  let time = clock()
  let env = {
    CLOCK: time,
    FILES: {
      fetch: (req: Request) => {
        sent.push(req.method)
        if (sent.length > cuts) return Promise.resolve(new Response('bytes'))
        return Promise.reject(
          Object.assign(new Error('Network connection lost.'), {
            retryable: true,
          }),
        )
      },
    },
  } as unknown as Env
  return { env, sent, time }
}

test('a read the runtime cuts off is sent again', async () => {
  let { env, sent, time } = cutting(2)
  let got = door(env).fetch(new Request('https://files.invalid/a.css'))
  await time.advance(100)
  await time.advance(500)
  assertEquals(await (await got).text(), 'bytes')
  assertEquals(sent, ['GET', 'GET', 'GET'])
})

test('an upload the runtime cuts off is its caller to send again', async () => {
  let { env, sent } = cutting(1)
  await assertRejects(
    () =>
      door(env).fetch(
        new Request('https://files.invalid/blob', {
          method: 'POST',
          body: 'x',
        }),
      ),
    Error,
    'Network connection lost.',
  )
  assertEquals(sent, ['POST'])
})
