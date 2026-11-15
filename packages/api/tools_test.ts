import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { runs, type Serving } from './tools.ts'
import type { Incoming, Listen } from './deno.ts'

test('a host that composed no handler has nothing to serve', async () => {
  await assertRejects(
    () =>
      runs({} as Serving).serve(
        { entity: { eid: 'serve' } },
        {} as Graph,
      ) as Promise<
        Bundle[]
      >,
    Error,
    'compose @yaks/api',
  )
})

test('serve authenticates every remote door before its handler runs', async () => {
  let stopping = new AbortController()
  let finished = Promise.withResolvers<void>()
  let bound = Promise.withResolvers<Incoming>()
  let answered = 0
  let host = {
    config: {},
    handler: () => {
      answered++
      return new Response('ok')
    },
    stopping: stopping.signal,
    duties: () => Promise.resolve(),
  } as unknown as Serving
  let listen: Listen = (opts, handle) => {
    equal(opts.hostname, '127.0.0.1')
    bound.resolve(handle)
    return {
      finished: finished.promise,
      shutdown: () => {
        finished.resolve()
        return Promise.resolve()
      },
    }
  }
  let work = runs(host, { token: 'private' }, listen).serve(
    { entity: { eid: 'serve' } },
    {} as Graph,
  )
  try {
    let handle = await bound.promise
    let remote = { remoteAddr: { hostname: '10.10.10.42', port: 1234 } }
    for (
      let path of [
        '/mcp',
        '/who',
        '/query',
        '/apply',
        '/ws',
        '/hooks/notice',
        '/',
      ]
    ) {
      equal(
        (await handle(
          new Request(`http://localhost${path}`, {
            method: 'POST',
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'admin_erase', arguments: {} },
            }),
          }),
          remote,
        )).status,
        401,
      )
    }
    equal(answered, 0)
    equal(
      (await handle(
        new Request('http://localhost/mcp', {
          headers: { authorization: 'Bearer private' },
        }),
        remote,
      )).status,
      200,
    )
    equal(answered, 1)
  } finally {
    stopping.abort()
    await work
  }
})
