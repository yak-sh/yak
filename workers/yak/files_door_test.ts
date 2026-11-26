// The files door (files.ts `door`) over a FILES binding the runtime cuts off.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { door, servableOf } from './files.ts'
import type { Env } from './env.ts'
import { within } from './defects.ts'

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

let uploads = 0

// A store behind FILES whose answers to whether an upload is served the test
// gives one ask at a time: `yes`, `fail` or nothing, which holds it.
let asking = () => {
  let time = clock()
  let asks: ((answer: Response) => void)[] = []
  let env = {
    CLOCK: time,
    FILES: {
      fetch: () => new Promise<Response>((answer) => asks.push(answer)),
    },
  } as unknown as Env
  let rep = {
    eid: 'r',
    scope: 'app',
    address: 'a'.repeat(64),
    media_type: 'image/png',
  }
  let upload = () => String(++uploads)
  let read = (sha: string) =>
    servableOf(env, { eid: 'app' }, { name: 's', app: {} } as never, sha, 'r')
  // The ask on its way to the store, once it gets there.
  let asked = async () => {
    for (let n = 0; !asks.length && n < 100; n++) await Promise.resolve()
    return asks.shift()!
  }
  let yes = async () => (await asked())(Response.json(rep))
  let fail = async () =>
    (await asked())(Response.json({ message: 'overloaded' }, { status: 503 }))
  return { time, asks, rep, upload, read, asked, yes, fail }
}

test('reads of one upload in a request ask its store once', async () => {
  let { asks, rep, upload, read, yes } = asking()
  let sha = upload()
  let reads = within(
    {},
    {},
    () => Promise.all([read(sha), read(sha), read(sha)]),
  )
  await yes()
  assertEquals([await reads, asks.length], [[rep, rep, rep], 0])
})

test('a store that fails or holds back answers with the yes last heard', async () => {
  let { time, rep, upload, read, asked, yes, fail } = asking()
  let sha = upload()
  let first = read(sha)
  await yes()
  assertEquals(await first, rep)
  let failing = read(sha)
  await fail()
  assertEquals(await failing, rep)
  let held = read(sha)
  await asked()
  await time.advance(1_000)
  assertEquals(await held, rep)
})

test('with no yes heard, a store that fails fails the read, and one that holds back fails it at 5 s, asked once', async () => {
  let { time, asks, upload, read, asked, fail } = asking()
  let failing = assertRejects(() => read(upload()), Error, 'overloaded')
  await fail()
  await failing
  let held = read(upload())
  let failed = assertRejects(() => held, Error, 'within 5 s')
  await asked()
  await time.advance(4_000)
  await time.advance(1_000)
  await failed
  assertEquals(asks.length, 0)
})
