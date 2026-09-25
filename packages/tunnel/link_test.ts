import { assertEquals } from '@std/assert'
import { GATEWAY, HEADER, link } from './link.ts'

// A door onto a server that answers with what reached it.
let door = (opened: { secret?: string; routes?: string[] }) => {
  let passed: Request[] = []
  let answer = link(opened, 'http://127.0.0.1:5173', (req) => {
    passed.push(req)
    return Promise.resolve(new Response('served'))
  })
  let ask = (path: string, secret?: string, init: RequestInit = {}) =>
    answer(
      new Request(`http://box${path}`, {
        ...init,
        headers: secret ? { [HEADER]: secret } : {},
      }),
    )
  return { ask, passed }
}

let opened = { secret: 's3cret', routes: ['/mail/inbound', '/hooks/*'] }

Deno.test('the link answers only with its secret', async () => {
  let d = door(opened)
  assertEquals((await d.ask('/mail/inbound')).status, 403)
  assertEquals((await d.ask('/mail/inbound', 'guess')).status, 403)
  assertEquals((await d.ask('/mail/inbound', 's3cret')).status, 200)
  assertEquals(
    (await door({ routes: opened.routes }).ask('/x', '')).status,
    403,
  )
})

Deno.test('the link answers only the paths the machine opened', async () => {
  let d = door(opened)
  for (let path of ['/apply', '/query', '/mail', '/mail/inbound/x']) {
    assertEquals((await d.ask(path, 's3cret')).status, 404, path)
  }
  assertEquals((await d.ask('/hooks/github', 's3cret')).status, 200)
  assertEquals(
    (await door({ secret: 's3cret' }).ask('/a', 's3cret')).status,
    404,
  )
})

Deno.test('what it admits reaches the server whole, secret taken off', async () => {
  let d = door(opened)
  await d.ask('/mail/inbound?to=jeff', 's3cret', {
    method: 'POST',
    body: 'a letter',
  })
  let [req] = d.passed
  assertEquals(req.url, 'http://127.0.0.1:5173/mail/inbound?to=jeff')
  assertEquals(req.method, 'POST')
  assertEquals(await req.text(), 'a letter')
  assertEquals(req.headers.has(HEADER), false)
})

Deno.test('a secret written after the door opened is the one it checks', async () => {
  let held: { secret?: string; routes: string[] } = { routes: ['/a'] }
  let d = door(held)
  assertEquals((await d.ask('/a', 'later')).status, 403)
  held.secret = 'later'
  assertEquals((await d.ask('/a', 'later')).status, 200)
})

Deno.test('the gateway passes a request on to the machine with the secret', async () => {
  let { default: gateway } = await import(
    `data:application/javascript,${encodeURIComponent(GATEWAY)}`
  )
  let reached: Request[] = []
  let env = {
    SECRET: 's3cret',
    BOX: {
      fetch: (req: Request) => {
        reached.push(req)
        return Promise.resolve(new Response('served'))
      },
    },
  }
  let res = await gateway.fetch(
    new Request('http://link/mail/inbound', {
      method: 'POST',
      headers: { [HEADER]: 'forged' },
      body: 'a letter',
    }),
    env,
  )
  assertEquals(await res.text(), 'served')
  assertEquals(reached[0].headers.get(HEADER), 's3cret')
  assertEquals(new URL(reached[0].url).pathname, '/mail/inbound')
  assertEquals(await reached[0].text(), 'a letter')
})
