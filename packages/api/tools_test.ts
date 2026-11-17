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

test('a dedicated listener sets ingress authority even when callers omit or replace it', async () => {
  let stop = new AbortController()
  let handlers = new Map<number, Incoming>()
  let closed: number[] = []
  let listen: Listen = (opts, handle) => {
    handlers.set(opts.port, handle)
    let done = Promise.withResolvers<void>()
    return {
      finished: done.promise,
      shutdown: () => {
        if (!closed.includes(opts.port)) closed.push(opts.port)
        done.resolve()
        return Promise.resolve()
      },
    }
  }
  let host = {
    config: { port: 5173 },
    stopping: stop.signal,
    duties: () => Promise.resolve(),
    handler: (req: Request) =>
      new Response(
        req.headers.get('x-yak-tunnel') == '1' ? 'narrowed' : 'local',
      ),
  } as unknown as Serving
  let work = runs(host, {
    listeners: [{ port: 5174, headers: { 'x-yak-tunnel': '1' } }],
  }, listen).serve({ entity: { eid: 'serve' } }, {} as Graph)
  let peer = { remoteAddr: { hostname: '127.0.0.1', port: 1 } }
  try {
    for (let mark of [undefined, '0', '']) {
      let req = new Request('http://box/apply', {
        headers: mark == null ? {} : { 'x-yak-tunnel': mark },
      })
      equal(await (await handlers.get(5174)!(req, peer)).text(), 'narrowed')
    }
    equal(
      await (await handlers.get(5173)!(new Request('http://box/apply'), peer))
        .text(),
      'local',
    )
  } finally {
    stop.abort()
    await work
  }
  equal(closed.sort(), [5173, 5174])
})
