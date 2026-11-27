// The kernel's door to a space's Builder (build-door.ts), asked of a Builder
// that answers as each case says.

import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { reseated, SEATED } from './build-door.ts'
import type { Env } from './env.ts'

/** A Builder answering each of its calls with the next of `answers`, a
 * status or a thrown fault, and the paths it was sent. */
let builder = (answers: (number | Error)[]) => {
  let paths: string[] = []
  let time = clock()
  let env = {
    CLOCK: time,
    BUILDER: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (req: Request) => {
          paths.push(new URL(req.url).pathname)
          let next = answers.shift() ?? 204
          if (next instanceof Error) return Promise.reject(next)
          return Promise.resolve(new Response(null, { status: next }))
        },
      }),
    },
  } as unknown as Pick<Env, 'BUILDER' | 'CLOCK'>
  return { env, paths, time }
}

test('a seat moving is sent again while the Builder answers a failure', async () => {
  let { env, paths, time } = builder([503, 500])
  let told = reseated(env, 'space')
  for (let pause = 0; pause < 3; pause++) await time.advance(20_000)
  await told
  assertEquals(paths, [SEATED, SEATED, SEATED])
})

test('a fault telling a seat moving is not sent again', async () => {
  let { env, paths } = builder([new TypeError('no such route')])
  await assertRejects(() => reseated(env, 'space'), TypeError)
  assertEquals(paths, [SEATED])
})
