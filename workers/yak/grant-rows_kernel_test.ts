// A person's agents are listed from their directory rows (grant-rows.ts), so
// a listing reads no KV, and shows a grant the moment it is made or revoked
// even while KV's own listing lags (it does, by up to a minute). A person
// whose grants were written before the rows is listed from KV once.
import { equal, test } from '@yaks/testing'
import { challenge } from '@yaks/oauth'
import { allowed, fresh, signIn } from './probe.ts'

// KV as the provider meets it, its listing frozen while `lagging` (as KV's
// edge answers a list it already holds) and its reads of grants counted.
type Kv = {
  list: (o: { prefix: string }) => Promise<{ keys: { name: string }[] }>
  get: (k: string, as?: unknown) => Promise<unknown>
  put: (k: string, v: string) => Promise<void>
}
let lagging = false
let reads = 0
let held: Kv
let k = await fresh({}, (env) => {
  held = env.OAUTH_KV as Kv
  let { list, get } = { list: held.list.bind(held), get: held.get.bind(held) }
  let frozen = new Map<string, Awaited<ReturnType<Kv['list']>>>()
  held.list = async (o) => {
    if (o.prefix.startsWith('grant:')) reads++
    if (!lagging) return frozen.set(o.prefix, await list(o)).get(o.prefix)!
    return frozen.get(o.prefix) ?? await list(o)
  }
  held.get = (key, as) => {
    if (key.startsWith('grant:')) reads++
    return get(key, as)
  }
})
addEventListener('unload', () => void k.stop())

let agents = async (cookie: string): Promise<string[]> => {
  let res = await k.at('yaks.app', '/oauth/agents', { headers: { cookie } })
  return (await res.json()).agents.map((a: { name: string }) => a.name)
}

// An agent connected by the person, the whole way: consent, then its code
// exchanged.
let connect = async (cookie: string, name: string) => {
  let back = 'http://127.0.0.1:9/cb'
  let registered = await k.at('yaks.app', '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [back],
      token_endpoint_auth_method: 'none',
    }),
  })
  let { client_id } = await registered.json()
  let verifier = crypto.randomUUID() + crypto.randomUUID()
  let q = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: back,
    scope: 'graph',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  }).toString()
  let allow = await allowed(k, q, cookie)
  let code = new URL(allow.headers.get('location')!).searchParams.get('code')!
  let token = await k.at('yaks.app', '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id,
      redirect_uri: back,
      code,
      code_verifier: verifier,
    }).toString(),
  })
  equal(token.status, 200)
  await token.body?.cancel()
  return client_id as string
}

let disconnect = async (cookie: string, agent: string) => {
  let res = await k.at('yaks.app', '/oauth/agents/disconnect', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ agent, return: '/connect' }).toString(),
  })
  await res.body?.cancel()
}

// A person who has listed their agents once, so their rows are whole.
let listedPerson = async () => {
  let them = await signIn(k)
  await agents(them.cookie)
  await k.settled()
  return them
}
let [lag, quiet] = [await listedPerson(), await listedPerson()]
let quietAgent = await connect(quiet.cookie, 'Quiet agent')

// A person holding a grant from before the rows, in the provider's own
// stored shape.
let before = await signIn(k)
await held!.put(
  `grant:${before.person}:old`,
  JSON.stringify({
    id: 'old',
    clientId: quietAgent,
    userId: before.person,
    scope: ['graph'],
    metadata: { client: 'Older agent' },
    createdAt: 1,
    redirectUri: 'http://127.0.0.1:9/cb',
  }),
)

test('an agent is listed the moment it connects and gone the moment it is disconnected, while KV lags', async () => {
  lagging = true
  try {
    let agent = await connect(lag.cookie, 'Lagging agent')
    equal(await agents(lag.cookie), ['Lagging agent'])
    await disconnect(lag.cookie, agent)
    equal(await agents(lag.cookie), [])
  } finally {
    lagging = false
  }
})

test("a person's agents are listed without reading KV", async () => {
  reads = 0
  equal(await agents(quiet.cookie), ['Quiet agent'])
  equal(reads, 0)
})

test('grants from before the rows are listed from KV once, and then from the rows', async () => {
  equal(await agents(before.cookie), ['Older agent'])
  await k.settled()
  reads = 0
  equal(await agents(before.cookie), ['Older agent'])
  equal(reads, 0)
})
