// Bot sign-in exercises the browser's real pages and keeps every private value off graph text.
import { equal, ok, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { compose } from '@yaks/cli/host'
import { type Comp, mint } from '@yaks/graph'
import { reveal } from '@yaks/secrets'
import { authorize, pick } from './mod.ts'
import { botCallback, yaksApp } from './yaks-app.ts'
import { authorizeCLI } from './cli.ts'

let origin = 'https://example.test'
let target =
  `${origin}/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A8765%2Foauth%2Fcallback&state=state`
let open = () =>
  compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/effects',
      '@yaks/secrets',
      '@yaks/connections',
    ],
  }, ['graph'])

test('bot OAuth walks code and consent pages without a browser or private input', async () => {
  let host = await open(), owner = mint(), codeAsked = 0
  let calls: string[] = []
  let go: typeof fetch = (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url.pathname)
    let headers = new Headers(init?.headers)
    equal(init?.redirect, 'manual')
    if (url.pathname.includes('oauth-protected-resource')) {
      return Promise.resolve(
        Response.json({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ['read', 'write'],
        }),
      )
    }
    if (url.pathname.includes('oauth-authorization-server')) {
      return Promise.resolve(Response.json({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        userinfo_endpoint: `${origin}/oauth/userinfo`,
        response_types_supported: ['code'],
      }))
    }
    if (url.pathname == '/oauth/register') {
      return Promise.resolve(
        Response.json({
          ...JSON.parse(String(init?.body)),
          client_id: 'client',
        }, { status: 201 }),
      )
    }
    let form = new URLSearchParams(String(init?.body))
    if (url.pathname == '/login') {
      equal(form.get('email'), 'probe@bot.yak.sh')
      return Promise.resolve(new Response('code sent'))
    }
    if (url.pathname == '/login/code') {
      equal(form.get('code'), '123456')
      return Promise.resolve(
        new Response(null, {
          status: 303,
          headers: { 'set-cookie': 'yak_session=website; HttpOnly' },
        }),
      )
    }
    if (url.pathname == '/oauth/authorize') {
      equal(headers.get('cookie'), 'yak_session=website')
      return Promise.resolve(
        new Response(
          `<form><input name="q" value="${
            url.search.slice(1).replaceAll('&', '&amp;')
          }"><input name="consent" value="page-consent"></form>`,
        ),
      )
    }
    if (url.pathname == '/oauth/allow') {
      equal(headers.get('cookie'), 'yak_session=website')
      equal(form.get('consent'), 'page-consent')
      let q = new URLSearchParams(form.get('q')!)
      return Promise.resolve(
        new Response(null, {
          status: 303,
          headers: {
            location: `http://localhost:8765/oauth/callback?state=${
              q.get('state')
            }&code=code`,
          },
        }),
      )
    }
    if (url.pathname == '/oauth/token') {
      return Promise.resolve(
        Response.json({
          access_token: 'oauth-bearer',
          refresh_token: 'refresh',
        }),
      )
    }
    if (url.pathname == '/oauth/userinfo') {
      equal(headers.get('authorization'), 'Bearer oauth-bearer')
      return Promise.resolve(
        Response.json({ sub: 'remote-person', email: 'probe@bot.yak.sh' }),
      )
    }
    throw new Error(`unexpected ${url.pathname}`)
  }
  // The OAuth code exchange uses the standard client's fetch. Keep this
  // test's global swap bounded, as the runtime runs these tests sequentially.
  let was = globalThis.fetch
  globalThis.fetch = go
  let auth = authorize(
    { graph: host.graph, vault: host.vault, owner },
    yaksApp(host, {
      origin,
      fetch: go,
      code: () => {
        codeAsked++
        return Promise.resolve('123456')
      },
    }),
  )
  try {
    let io = {
      say: () => {},
      hidden: () => {
        throw new Error('no paste for bot')
      },
    }
    equal(
      await authorizeCLI(auth, 'yaks.app', io, 'probe@bot.yak.sh'),
      'yaks.app connected.',
    )
    let b = await pick(host.graph.read, owner, 'yaks.app')
    if (!b) throw new Error('no connection')
    equal((b.connection as Comp).account, 'probe@bot.yak.sh')
    equal(
      JSON.parse((await reveal(host.vault, String((b.secret as Comp).name)))!)
        .website_session,
      'website',
    )
    ok(
      !JSON.stringify(await host.graph.read('.connection&*')).includes(
        'oauth-bearer',
      ),
    )
    equal(codeAsked, 1)
    ok(calls.includes('/oauth/register'))
    // A repeat uses the registered client, does not rediscover, and renews the same connection.
    let first = b.entity.eid,
      discoveries = calls.filter((p) => p == '/oauth/register').length
    await authorizeCLI(auth, 'yaks.app', io, 'probe@bot.yak.sh')
    equal((await pick(host.graph.read, owner, 'yaks.app'))?.entity.eid, first)
    equal(calls.filter((p) => p == '/oauth/register').length, discoveries)
  } finally {
    globalThis.fetch = was
    await auth.close()
    await host.close()
  }
})

test('held session migration spends no sign-in code and never follows a foreign consent return', async () => {
  let pages = 0
  let go: typeof fetch = (_input, init) => {
    pages++
    equal(new Headers(init?.headers).get('cookie'), 'yak_session=held')
    return Promise.resolve(
      pages == 1
        ? new Response(
          '<input name="q" value="request"><input name="consent" value="consent">',
        )
        : new Response(null, {
          status: 303,
          headers: { location: 'https://foreign.test/callback?code=stolen' },
        }),
    )
  }
  await assertRejects(
    () =>
      botCallback({ read: () => [] }, target, '', {
        fetch: go,
        session: 'held',
        code: () => {
          throw new Error('must not ask')
        },
      }),
    Error,
    'another redirect',
  )
  equal(pages, 2)
})
