import { test } from '@yaks/testing'
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import type { Env } from '../env.ts'
import { type FrontEnv, serve } from '../front/front.ts'
import { handler } from '../kernel.ts'
import { bearerFor, connector, fresh, signIn } from '../probe.ts'
import { fetch, QUERY_VERSION } from './worker.ts'

test('the front serves anonymous, authenticated and sandboxed queries through the query Worker', async () => {
  let env!: Env
  let k = await fresh({}, (binding) => env = binding)
  try {
    let owner = await signIn(k)
    let space = owner.email.split('@')[0]
    let agent = connector(k, owner.cookie)
    let put = async (app: string, title: string) =>
      await agent.tool('graph_apply', {
        app,
        entities: [{ entity: { eid: '$one' }, doc: { title } }],
      })
    await agent.tool('app_new', { slug: 'public', title: 'Public' })
    await agent.tool('app_files', {
      app: 'public',
      files: [{ path: 'index.html', content: '<h1>Public</h1>' }],
    })
    await agent.tool('app_deploy', { app: 'public' })
    let release = `query-${crypto.randomUUID().slice(0, 8)}`
    await agent.tool('app_publish', { app: 'public', name: release })
    await agent.tool('app_install', { name: release, as: 'sandbox' })
    await agent.tool('app_set', {
      app: 'sandbox',
      access: 'private',
      sandboxed: true,
    })
    await agent.tool('app_deploy', { app: 'sandbox' })
    await agent.tool('app_new', {
      slug: 'private',
      title: 'Private',
      access: 'private',
    })
    await put('public', 'Public row')
    await put('private', 'Private row')
    await put('sandbox', 'Sandbox row')
    let host = `${space}.${k.host}`
    let cookie = owner.cookie
    let page = await k.at(host, '/sandbox/', { headers: { cookie } })
    let path = /<base href="([^"]+)"/.exec(await page.text())![1]
    let token = path.split('/')[2].slice(1)
    let bearer = await bearerFor(k, cookie)
    let kernelCalls = 0
    let front: FrontEnv = {
      APEX: k.host,
      QUERY: { fetch: (req: Request) => fetch(req, env) } as FrontEnv['QUERY'],
      KERNEL: {
        fetch: (req: Request) => {
          kernelCalls++
          return handler.fetch(req, env)
        },
      } as FrontEnv['KERNEL'],
      SITE: {
        fetch: () => {
          throw Error('A query reached Site')
        },
      } as FrontEnv['SITE'],
      USES: { used: () => {}, wake: () => {} },
      CLI: {
        fetch: () => {
          throw Error('A query reached CLI')
        },
      } as FrontEnv['CLI'],
    }
    let send = (path: string, headers: HeadersInit = {}, method = 'GET') =>
      serve(
        new Request(`https://${host}${path}`, {
          headers,
          method,
          redirect: 'manual',
        }),
        front,
        { waitUntil: () => {} },
      )
    let row = async (
      path: string,
      title: string,
      headers: HeadersInit = {},
    ) => {
      let answer = await send(path, headers)
      assertEquals(answer.status, 200, await answer.clone().text())
      assertEquals(answer.headers.get('cache-control'), 'private, no-store')
      assertMatch(answer.headers.get('server-timing')!, /gateway;dur=/)
      assertEquals(answer.headers.has(QUERY_VERSION), true)
      assertEquals((await answer.json())[0].doc.title, title)
      return answer.headers
    }
    let query = 'api/query?.doc'
    let publicHeaders = await row('/public/' + query, 'Public row')
    assertStringIncludes(publicHeaders.get('set-cookie')!, 'yak_session=')
    await agent.tool('app_set', { app: 'public', home: true })
    await row('/' + query, 'Public row')
    await row('/public//' + query, 'Public row')
    await row('/private/' + query, 'Private row', { cookie })
    await row('/private/' + query, 'Private row', {
      authorization: `Bearer ${bearer}`,
    })
    let walled = await row(path + query, 'Sandbox row', { origin: 'null' })
    assertEquals(walled.get('access-control-allow-origin'), '*')
    assertEquals(walled.get('access-control-allow-credentials'), null)
    assertStringIncludes(walled.get('content-security-policy')!, 'sandbox')
    let preflight = await send(path + query, {
      origin: 'null',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    }, 'OPTIONS')
    assertEquals(preflight.status, 204)
    assertEquals(preflight.headers.get('access-control-allow-origin'), '*')
    assertEquals(preflight.headers.has(QUERY_VERSION), true)
    await row('/sandbox/' + query, 'Sandbox row', {
      authorization: `Bearer ${token}`,
    })
    let refusals: [string, HeadersInit, number][] = [
      ['/private/', {}, 401],
      ['/public/', { authorization: 'Bearer invalid', cookie }, 401],
      ['/sandbox/', { cookie }, 401],
      [`/private/~${token}/`, { origin: 'null' }, 404],
    ]
    for (let [target, headers, status] of refusals) {
      let answer = await send(target + query, headers)
      assertEquals(answer.status, status, await answer.clone().text())
      assertEquals(answer.headers.has(QUERY_VERSION), true)
      await answer.body?.cancel()
    }
    assertEquals(kernelCalls, 0)

    front.QUERY = {
      fetch: (req: Request) =>
        fetch(req, { ...env, SESSION_SECRET: undefined }),
    } as FrontEnv['QUERY']
    let passed = await send('/public/' + query)
    assertEquals(passed.headers.has(QUERY_VERSION), false)
    assertEquals(kernelCalls, 1)
    assertEquals((await passed.json())[0].doc.title, 'Public row')
  } finally {
    await k.stop()
  }
})
