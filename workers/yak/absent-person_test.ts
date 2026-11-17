import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { bearerFor, connector, kernel, signIn } from './probe.ts'
import { sign } from './lib/token.ts'
import { line } from '@yaks/query'

let k = await kernel(), gone = await signIn(k), live = await signIn(k)
let grant =
  /yak login (\S+)/.exec(await connector(k, gone.cookie).tool('grant'))![1]
let oauth = await bearerFor(k, gone.cookie)
let old = `yak_session=${await sign({
  person: gone.person,
  space: null,
  exp: Math.floor(Date.now() / 1000) + 3600,
}, k.secret)}`
await k.dir.stamp({
  entities: [{ entity: { eid: gone.person }, $delete: true }],
})

test('an absent person’s cookies, grants and connector tokens cannot authenticate or recreate them', async () => {
  for (let cookie of [gone.cookie, old]) {
    let r = await k.at(k.host, '/login/who', { headers: { cookie } })
    assertEquals((await r.json()).signedIn, false)
  }
  let credentials: Record<string, string>[] = [{ cookie: gone.cookie }, {
    cookie: old,
  }, {
    authorization: `Bearer ${grant}`,
  }, { authorization: `Bearer ${oauth}` }]
  for (let headers of credentials) {
    let r = await k.at(k.host, '/mcp', {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'space_new', arguments: { slug: 'ghost-account' } },
      }),
    })
    assertEquals(r.status, 401)
    await r.body?.cancel()
  }
  assertEquals(await k.dir.hasPerson(gone.person), false)
  assertEquals(
    (await k.dir.read(line`.entity.eid=${gone.person}&.person`)).length,
    0,
  )
  let r = await k.at(k.host, '/login/who', { headers: { cookie: live.cookie } })
  assertEquals((await r.json()).signedIn, true)
})
