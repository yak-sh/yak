import { assertEquals } from '@std/assert'
import { filter } from './filter.ts'
import { GATEWAY, HEADER } from './gateway.ts'

// What the machine's filter does with a request at `path`: `pass`, or the
// refusal's name.
let seen = (routes: string[] | undefined, path: string, marked: boolean) => {
  let req = new Request(`http://box${path}`, {
    headers: marked ? { [HEADER]: '1' } : {},
  })
  try {
    filter(routes)(req)
    return 'pass'
  } catch (e) {
    return (e as Error).name
  }
}

Deno.test('a request through the tunnel passes only at an opened path', () => {
  let routes = ['/mail/inbound', '/hooks/*']
  for (let path of ['/mail/inbound', '/mail/inbound?to=a', '/hooks/github']) {
    assertEquals(seen(routes, path, true), 'pass', path)
  }
  for (let path of ['/apply', '/query', '/ws', '/mail', '/mail/inbound/x']) {
    assertEquals(seen(routes, path, true), 'Denied', path)
  }
  assertEquals(seen(undefined, '/mail/inbound', true), 'Denied')
})

Deno.test('a request that did not come through the tunnel is untouched', () => {
  for (let path of ['/apply', '/query', '/mail/inbound']) {
    assertEquals(seen([], path, false), 'pass', path)
  }
})

Deno.test('the gateway marks every request it passes on, whatever it said', async () => {
  let { default: gateway } = await import(
    `data:application/javascript,${encodeURIComponent(GATEWAY)}`
  )
  let reached: Request[] = []
  let env = {
    BOX: {
      fetch: (req: Request) => {
        reached.push(req)
        return Promise.resolve(new Response('served'))
      },
    },
  }
  let send = (headers: HeadersInit) =>
    gateway.fetch(
      new Request('http://tunnel/mail/inbound', {
        method: 'POST',
        headers,
        body: 'a letter',
      }),
      env,
    )
  assertEquals(await (await send({})).text(), 'served')
  await send({ [HEADER]: '' })
  assertEquals(reached.map((r) => r.headers.get(HEADER)), ['1', '1'])
  assertEquals(new URL(reached[0].url).pathname, '/mail/inbound')
  assertEquals(await reached[0].text(), 'a letter')
})
