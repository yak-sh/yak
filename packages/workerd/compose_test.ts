import { equal, test, throws } from '@yaks/testing'
import type { Route } from '@yaks/api'
import { compose, type Entry, type WorkerFacet } from './compose.ts'
import * as workerd from './plugin.ts'
import { VERSION } from './version.ts'

let at = (path: string, method = 'GET') =>
  new Request(`https://x.test${path}`, { method })
let says = (method: string, path: string, said: string): Route => ({
  method,
  path,
  handle: () => new Response(said),
})
let text = async (res: Response | Promise<Response>) => (await res).text()

// Every invocation the Worker enters, by name and request path.
let entering = () => {
  let entered: string[] = []
  let entry: Entry = (_env, name, run, request) => {
    entered.push(request ? `${name} ${new URL(request.url).pathname}` : name)
    return run()
  }
  return { entered, facet: { entry: () => Promise.resolve(entry) } }
}

test('a request takes the first route of the plugins in config order', async () => {
  let yak = compose({ plugins: ['a', 'b'] }, {
    a: { routes: () => [says('GET', '/a', 'a'), says('POST', '/b', 'a post')] },
    b: { routes: () => [says('GET', '/b', 'b'), says('*', '*', 'rest')] },
  })
  let env = {}
  equal(
    await Promise.all(
      [at('/a'), at('/b'), at('/b', 'POST'), at('/c')].map((r) =>
        text(yak.default.fetch(r, env))
      ),
    ),
    ['a', 'b', 'a post', 'rest'],
  )
  let none = compose({ plugins: ['a'] }, { a: {} })
  equal((await none.default.fetch(at('/a'), env)).status, 404)
})

test("a plugin's routes are given its options, read from the env, once per env", async () => {
  let built = 0
  let yak = compose(
    { plugins: [{ use: 'a', with: { hello: { secret: 'HELLO' } } }] },
    {
      a: {
        routes: (o) => {
          built++
          return [{
            method: 'GET',
            path: '/',
            handle: () => new Response(String(o.hello)),
          }]
        },
      },
    },
  )
  let env = { HELLO: 'hi' }
  equal(await text(yak.default.fetch(at('/'), env)), 'hi')
  env.HELLO = 'again'
  equal(await text(yak.default.fetch(at('/'), env)), 'again')
  await yak.default.fetch(at('/'), { HELLO: 'other' })
  equal(built, 2)
})

test('the version route answers the deploy first, a HEAD without its body', async () => {
  let yak = compose({
    plugins: [
      {
        use: '@yaks/workerd',
        with: { name: 'shop', version: { binding: 'VERSION' } },
      },
      'rest',
    ],
  }, {
    '@yaks/workerd': workerd,
    rest: { routes: () => [says('*', '*', 'rest')] },
  })
  let env = { VERSION: { id: 'v7' } }
  let got = await yak.default.fetch(at(VERSION), env)
  equal(
    [await got.json(), got.headers.get('cache-control')],
    [{ shop: 'v7' }, 'no-store'],
  )
  equal(await text(yak.default.fetch(at(VERSION, 'HEAD'), env)), '')
  equal(await text(yak.default.fetch(at(VERSION, 'POST'), env)), 'rest')
})

test('letters and batches go to the one plugin that handles them, inside the entry', async () => {
  let { entered, facet } = entering()
  let heard: unknown[] = []
  let yak = compose({ plugins: ['tracker', 'mail'] }, {
    tracker: facet,
    mail: {
      email: (_o, env) => (letter) =>
        Promise.resolve(void heard.push([letter, env])),
      queue: () => (batch) => Promise.resolve(void heard.push(batch)),
    },
  })
  let env = { at: 'env' }, ctx = { waitUntil: () => {} }
  await yak.default.email!('letter', env, ctx)
  await yak.default.queue!('batch', env, ctx)
  await yak.default.fetch(at('/x'), env)
  equal(heard, [['letter', env], 'batch'])
  equal(entered, ['gateway email', 'gateway queue', 'gateway fetch /x'])
  equal(Object.keys(compose({ plugins: [] }, {}).default), ['fetch'])
})

test('a config whose plugins collide, or name one with no facet, is refused', () => {
  let twice: WorkerFacet = { email: () => () => Promise.resolve() }
  throws(
    () => compose({ plugins: ['a', 'b'] }, { a: twice, b: twice }),
    'a and b both give a Worker its email',
  )
  let one: WorkerFacet = {
    classes: { Shop: { base: Object, methods: [], load: () => never() } },
  }
  throws(
    () => compose({ plugins: ['a', 'b'] }, { a: one, b: one }),
    'b defines Shop again',
  )
  throws(() => compose({ plugins: ['gone'] }, {}), 'no ./worker facet for gone')
})

let never = (): Promise<never> => Promise.reject(Error('not loaded'))

class Base {
  constructor(readonly ctx: unknown, readonly env: unknown) {}
}

test('a class is made on its first call, and an entered one answers inside the entry', async () => {
  let { entered, facet } = entering()
  let loads = 0
  let make = () => {
    loads++
    return Promise.resolve((ctx: string, env: { name: string }) => ({
      ask: (req: Request) => `${ctx} ${env.name} ${new URL(req.url).pathname}`,
    }))
  }
  let yak = compose({ plugins: ['tracker', 'shop'] }, {
    tracker: facet,
    shop: {
      classes: {
        Shop: { base: Base, methods: ['ask'], load: make, entered: true },
        Quiet: { base: Base, methods: ['ask'], load: make },
      },
    },
  })
  type Asking = Base & { ask(req: Request): Promise<string> }
  let shop = new yak.classes.Shop('ctx', { name: 'shop' }) as Asking
  let quiet = new yak.classes.Quiet('ctx', { name: 'quiet' }) as Asking
  equal([shop.ctx, loads], ['ctx', 0])
  equal(await shop.ask(at('/a')), 'ctx shop /a')
  equal(await quiet.ask(at('/b')), 'ctx quiet /b')
  equal([loads, entered], [2, ['Shop ask /a']])
})
