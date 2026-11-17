import { setImmediate } from 'node:timers'
import { equal, test } from '@yaks/testing'
import { fetch } from './directory.ts'
import { EPOCH } from './directory-copy.ts'

test('parallel directory clients share a query trip, then read fresh', async () => {
  let calls: Request[] = [], answers: ((r: Response) => void)[] = []
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          calls.push(request)
          return new Promise<Response>((answer) => answers.push(answer))
        },
      }),
    },
  }
  let ask = () =>
    fetch(
      new Request('http://directory/query?q=.app.slug=busy', {
        headers: { [EPOCH]: '1' },
      }),
      env,
    )
  let reads = Array.from({ length: 100 }, ask)
  await new Promise<void>((done) => setImmediate(done))
  let sent = calls.length
  answers.forEach((answer) =>
    answer(Response.json([{ app: { slug: 'busy' } }], {
      headers: { [EPOCH]: '5' },
    }))
  )
  let responses = await Promise.all(reads)
  equal(sent, 1)
  equal(
    await Promise.all(responses.map((r) => r.json())),
    Array(100).fill([{ app: { slug: 'busy' } }]),
  )
  equal(responses.map((r) => r.headers.get(EPOCH)), Array(100).fill('5'))
  let later = ask()
  await new Promise<void>((done) => setImmediate(done))
  equal(calls.length, 2)
  answers[1](Response.json([], { headers: { [EPOCH]: '6' } }))
  equal(await (await later).json(), [])
})
