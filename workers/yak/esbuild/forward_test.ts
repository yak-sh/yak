import { equal, test } from '@yaks/testing'
import { forwarded, REPLACED } from './forward.ts'

test('compiler jobs carry the kernel catalog and preserve container refusals', async () => {
  let catalog = '{"toolkit":"this kernel"}'
  let ask = '{"pages":["main.ts"]}'
  let job = `{"ask":${ask},"catalog":${catalog}}`
  let response = new Response('compiler outgrew memory', { status: 507 })
  let send = async (req: Request) => {
    equal(req.url, 'http://compiler/')
    equal(req.headers.get('content-type'), 'application/json')
    equal(await req.text(), job)
    return response
  }
  equal(
    await forwarded(
      new Request('http://binding/', {
        method: 'POST',
        headers: { 'x-yak-compiler-job': '1' },
        body: job,
      }),
      send,
    ),
    response,
  )
  equal(
    (await forwarded(
      new Request('http://binding/', {
        method: 'POST',
        body: ask,
      }),
      send,
    )).status,
    // An older kernel must never compile against a guessed toolkit catalog.
    400,
  )
  equal(
    (await forwarded(new Request('http://binding/'), send)).status,
    405,
  )
})

// The answers `send` gives in turn, a function being a throw, and the jobs it
// was sent.
let compiler = (...answers: (number | (() => never))[]) => {
  let jobs: string[] = []
  let send = async (req: Request) => {
    jobs.push(await req.text())
    let next = answers.shift()!
    return typeof next == 'number'
      ? new Response(`${next}`, { status: next })
      : next()
  }
  return { jobs, send }
}

let job = () =>
  new Request('http://binding/', {
    method: 'POST',
    headers: { 'x-yak-compiler-job': '1' },
    body: '{"ask":{}}',
  })

let reset = () => {
  throw Object.assign(new Error('Durable Object reset'), { retryable: true })
}

test('a compile the compiler restarted under is sent once more, whole', async () => {
  for (let first of [REPLACED, reset]) {
    let { jobs, send } = compiler(first, 200)
    equal((await forwarded(job(), send)).status, 200)
    equal(jobs, ['{"ask":{}}', '{"ask":{}}'])
  }
  let { jobs, send } = compiler(REPLACED, REPLACED)
  equal((await forwarded(job(), send)).status, REPLACED)
  equal(jobs.length, 2)
})

test('a compile that outgrew memory or failed otherwise is not sent again', async () => {
  let { jobs, send } = compiler(507, 200)
  equal((await forwarded(job(), send)).status, 507)
  equal(jobs.length, 1)
  let broke = compiler(() => {
    throw new Error('broke')
  }, 200)
  let thrown = await forwarded(job(), broke.send).catch((e) => e.message)
  equal([thrown, broke.jobs.length], ['broke', 1])
})
