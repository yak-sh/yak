import { equal, match, test } from '@yaks/testing'
import { client } from '@yaks/oauth'
import { kept, provider, register } from './signin.ts'

let YAKS = {
  name: 'yaks.app',
  origin: 'https://yaks.app',
  socket: 'wss://yaks.app/manage/{space}/operator?browser=1',
}
let REDIRECT = 'https://abc.chromiumapp.org/'

// A door that answers each request with `body`, and keeps what it was sent.
let door = (body: unknown) => {
  let sent: { url: string; body: string }[] = []
  let ask = (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body) })
    return Promise.resolve(Response.json(body))
  }
  return { sent, ask }
}

let area = () => {
  let m = new Map<string, unknown>()
  return {
    get: (k: string) => Promise.resolve(m.get(k)),
    set: (k: string, v: unknown) => Promise.resolve(void m.set(k, v)),
  }
}

// A sign-in through the host's door as the extension runs it: the link, then
// the code the redirect brings back.
let signin = async (ask: typeof fetch) => {
  let c = client(provider(YAKS, 'c1'), {
    store: kept(area()),
    key: 'grant',
    redirect: REDIRECT,
    fetch: ask,
  })
  let { url, attempt } = await c.begin()
  await c.complete(attempt, `${REDIRECT}?code=k&state=${attempt.state}`)
  return { c, url, attempt }
}

// The runtime's first sign-in sets up Web Crypto, URLs and responses; no case
// times that.
await signin(door({ access_token: 'warm' }).ask)
await register(YAKS, REDIRECT, door({ client_id: 'warm' }).ask)

test('the extension registers itself as a public client for its redirect', async () => {
  let { sent, ask } = door({ client_id: 'c1' })
  equal(await register(YAKS, REDIRECT, ask), 'c1')
  equal(sent[0].url, 'https://yaks.app/oauth/register')
  match(JSON.parse(sent[0].body), {
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
  })
})

test('signing in asks the host to authorize with PKCE, then trades the code', async () => {
  let { sent, ask } = door({ access_token: 'at', refresh_token: 'rt' })
  let { c, url, attempt } = await signin(ask)
  let link = new URL(url)
  equal(link.origin + link.pathname, 'https://yaks.app/oauth/authorize')
  match(Object.fromEntries(link.searchParams), {
    response_type: 'code',
    client_id: 'c1',
    redirect_uri: REDIRECT,
    scope: 'graph',
    state: attempt.state,
    code_challenge_method: 'S256',
  })
  equal(sent[0].url, 'https://yaks.app/oauth/token')
  match(Object.fromEntries(new URLSearchParams(sent[0].body)), {
    grant_type: 'authorization_code',
    code: 'k',
    code_verifier: attempt.verifier,
    client_id: 'c1',
    redirect_uri: REDIRECT,
  })
  equal(await c.token(), 'at')
})

test('the grant store runs updates one at a time and keeps a failed one', async () => {
  let store = kept(area())
  let order: string[] = []
  let slow = store.update('g', async (r) => {
    await Promise.resolve()
    order.push('first')
    r.access_token = 'one'
    throw new Error('refused')
  })
  let next = store.update('g', (r) => {
    order.push(`second saw ${r.access_token}`)
    return Promise.resolve()
  })
  await slow.catch(() => {})
  await next
  equal(order, ['first', 'second saw one'])
})

test('a host that refuses to register says so', async () => {
  let ask = () => Promise.resolve(new Response('no', { status: 400 }))
  let err = await register(YAKS, REDIRECT, ask).catch((e) => e.message)
  equal(err, 'yaks.app refused to register the extension.')
})
