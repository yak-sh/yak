import { equal, test } from '@yaks/testing'
import { COOKIE as HOME } from './variant.ts'
import type { Env } from './env.ts'
import { HANDOFF } from './handoff.ts'
import { handler } from './kernel.ts'

let policy = 'max-age=31536000; includeSubDomains'
let env = (answer: (req: Request) => Response) => {
  let door = { fetch: (req: Request) => Promise.resolve(answer(req)) }
  return {
    SITE: door,
    APPS: door,
    ASSETS: door,
    IDENTITY: door,
  } as unknown as Env
}

test('a hostname override cannot route a production request into an app', async () => {
  let bindings = {
    ...env(() => new Response('platform')),
    APPS: { fetch: () => Promise.resolve(new Response('app')) },
  }
  let req = new Request('http://127.0.0.1/login', {
    headers: { 'x-yak-host': 'override.yaks.app' },
  })
  equal(await (await handler.fetch(req, bindings)).text(), 'platform')
})

for (let host of ['yaks.app', 'hsts.yaks.app']) {
  for (let status of [200, 302, 404, 503, 101]) {
    test(`HSTS covers ${host} responses with status ${status}`, async () => {
      let res = await handler.fetch(
        // Holding today's home page, so the split (variant.ts) keeps no
        // cookie of its own.
        new Request(`https://${host}/`, { headers: { cookie: `${HOME}=ask` } }),
        env(() =>
          new Response(status == 101 ? null : 'answer', {
            status,
            headers: {
              'strict-transport-security': 'max-age=0',
              'location': '/next',
              'set-cookie': 'app=value; Secure',
            },
          })
        ),
      )
      equal(res.headers.get('strict-transport-security'), policy)
      equal(res.status, status)
      equal(res.headers.get('location'), '/next')
      equal(res.headers.get('set-cookie'), 'app=value; Secure')
      equal(await res.text(), status == 101 ? '' : 'answer')
    })
  }
}

test('HSTS covers an immutable redirect response', async () => {
  let res = await handler.fetch(
    new Request('https://yaks.app/'),
    env(() => Response.redirect('https://yaks.app/next')),
  )
  equal(res.headers.get('strict-transport-security'), policy)
  equal(res.status, 302)
})

test('HSTS covers a foreign-origin refusal', async () => {
  let res = await handler.fetch(
    new Request('https://hsts.yaks.app/app/api/apply', {
      method: 'POST',
      headers: { origin: 'https://another.yaks.app' },
    }),
    env(() => {
      throw Error('must refuse before serving')
    }),
  )
  equal(res.status, 403)
  equal(res.headers.get('strict-transport-security'), policy)
})

test('HSTS covers a caught platform failure', async () => {
  let res = await handler.fetch(
    new Request('https://yaks.app/'),
    env(() => {
      throw Error('failed to serve')
    }),
  )
  equal(res.status, 500)
  equal(res.headers.get('strict-transport-security'), policy)
})

test('HSTS covers a preflight response', async () => {
  let res = await handler.fetch(
    new Request('https://hsts.yaks.app/~token/api/query', {
      method: 'OPTIONS',
    }),
    env(() => {
      throw Error('must preflight before serving')
    }),
  )
  equal(res.status, 204)
  equal(res.headers.get('strict-transport-security'), policy)
  equal(res.headers.get('access-control-allow-origin'), '*')
})

test('a custom domain keeps its own transport policy', async () => {
  let res = await handler.fetch(
    new Request(`https://customer.example${HANDOFF}`),
    env(() =>
      new Response('handoff', {
        headers: { 'strict-transport-security': 'max-age=60' },
      })
    ),
  )
  equal(res.headers.get('strict-transport-security'), 'max-age=60')
})

test('an app is never handed a doubled slash, at any mount', async () => {
  for (
    let address of [
      'https://pb.yaks.app/printbound//refund?x=1',
      'https://pb.yaks.app//printbound///refund?x=1',
    ]
  ) {
    let res = await handler.fetch(
      new Request(address),
      env((req) => new Response(req.url)),
    )
    equal(await res.text(), 'https://pb.yaks.app/printbound/refund?x=1')
  }
})
