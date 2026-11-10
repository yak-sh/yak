import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Callers, Closed, filter, offered } from './filter.ts'
import { CALLER, GATEWAY, HEADER } from './gateway.ts'

// A request at `path`: through the tunnel when `marked`, from the caller the
// platform names in `word`.
let asked = (path: string, marked: boolean, word?: string) =>
  new Request(`http://box${path}`, {
    headers: {
      ...marked ? { [HEADER]: '1' } : {},
      ...word == null ? {} : { [CALLER]: word },
    },
  })

// What the machine's filter does with a request at `path`: `pass`, or the
// refusal's name.
let seen = (
  routes: string[] | undefined,
  path: string,
  marked: boolean,
  word?: string,
  callers?: Callers,
) => {
  try {
    filter(routes, callers)(asked(path, marked, word))
    return 'pass'
  } catch (e) {
    return (e as Error).name
  }
}

test('a request through the tunnel passes only at an opened path', () => {
  let routes = ['/mail/inbound', '/hooks/*']
  for (let path of ['/mail/inbound', '/mail/inbound?to=a', '/hooks/github']) {
    assertEquals(seen(routes, path, true), 'pass', path)
  }
  for (let path of ['/apply', '/query', '/ws', '/mail', '/mail/inbound/x']) {
    assertEquals(seen(routes, path, true), 'Denied', path)
  }
  assertEquals(seen(undefined, '/mail/inbound', true), 'Denied')
})

test('a request that did not come through the tunnel is untouched', () => {
  for (let path of ['/apply', '/query', '/mail/inbound']) {
    assertEquals(seen([], path, false), 'pass', path)
  }
})

// A machine that takes mail from every app in the space, and lends its tools
// and its model steps to its owner's Operator alone.
let MAIL = ['/mail/inbound']
let LENT: Callers = {
  operator: { routes: ['/mcp', '/model/step'], tools: ['task_new'] },
}

test('a path opened to one caller answers only the request the platform says is from it', () => {
  for (let path of ['/mcp', '/model/step']) {
    assertEquals(seen(MAIL, path, true, 'operator', LENT), 'pass', path)
    // An app's worker, the owner's connector, a platform that says no word,
    // and words no config names: an object's own machinery among them.
    for (let word of ['app', 'connector', undefined, '', 'constructor']) {
      assertEquals(seen(MAIL, path, true, word, LENT), 'Denied', `${word}`)
    }
  }
  for (let word of ['app', 'connector', 'operator', undefined]) {
    assertEquals(seen(MAIL, '/mail/inbound', true, word, LENT), 'pass')
    assertEquals(seen(MAIL, '/apply', true, word, LENT), 'Denied')
  }
  // The word is the platform's to the tunnel: without the gateway's mark it
  // narrows nothing.
  assertEquals(seen(MAIL, '/apply', false, 'app', LENT), 'pass')
})

test('a caller is offered its own tools beside everyone’s', () => {
  let tools = offered(['task_list'], LENT)
  assertEquals(tools(asked('/mcp', true, 'operator')), [
    'task_list',
    'task_new',
  ])
  for (let word of ['app', 'connector', undefined]) {
    assertEquals(tools(asked('/mcp', true, word)), ['task_list'], `${word}`)
  }
  assertEquals(offered([], LENT)(asked('/mcp', true, 'app')), [])
  assertEquals(tools(asked('/mcp', false, 'operator')), undefined)
})

test('changing opened routes changes the same filter', () => {
  let routes = ['/hooks/*']
  let only = filter(routes)
  let req = new Request('http://box/hooks/github', {
    headers: { [HEADER]: '1' },
  })
  only(req)
  routes[0] = '/mail/inbound'
  assertEquals(assertThrows(() => only(req), Closed).name, 'Denied')
  routes[0] = '/hooks/*'
  only(req)
})

// The gateway's module, loaded as the platform uploads it.
let { default: gateway } = await import(
  `data:application/javascript,${encodeURIComponent(GATEWAY)}`
)

test('the gateway marks every request it passes on, whatever it said', async () => {
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

// A streamed answer, read through the gateway as the file loads: the first
// piece while the machine still holds the rest.
let streamed = await (async () => {
  let more = Promise.withResolvers<void>()
  let said = (text: string) => new TextEncoder().encode(text)
  let env = {
    BOX: {
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              async start(out) {
                out.enqueue(said('first'))
                await more.promise
                out.enqueue(said('last'))
                out.close()
              },
            }),
          ),
        ),
    },
  }
  let response: Response = await gateway.fetch(
    new Request('http://tunnel/model/step', { method: 'POST', body: '{}' }),
    env,
  )
  let reader = response.body!.getReader()
  let read = async () => new TextDecoder().decode((await reader.read()).value)
  let first = await read()
  more.resolve()
  return [first, await read()]
})()

test('the gateway passes a streamed answer on as it arrives', () => {
  assertEquals(streamed, ['first', 'last'])
})
