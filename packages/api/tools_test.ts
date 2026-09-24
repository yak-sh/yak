/// <reference lib="deno.ns" />
// The `serve` tool, over a host written here: no database, no plugins, just
// the four things it reads off the host it was composed into.

import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import type { Runner } from '@yaks/tools'
import { PORT, runs, type Serving } from './tools.ts'

// A port this box is not using, asked for and given back.
let free = (): number => {
  let l = Deno.listen({ port: 0 })
  let { port } = l.addr as Deno.NetAddr
  l.close()
  return port
}

// The tool reconciles and takes the duties before it binds, so the
// port is not up on the first tick. Retry rather than count the ticks.
let said = async (url: string, ms = 2000): Promise<string> => {
  let end = Date.now() + ms
  for (;;) {
    try {
      return await fetch(url).then((r) => r.text())
    } catch (error) {
      if (Date.now() > end) throw error
      await new Promise((go) => setTimeout(go, 5))
    }
  }
}

// The call the runner hands the tool; the graph it is handed is never read.
let asked = (args: Record<string, unknown> = {}): Bundle => ({
  entity: { eid: 'c1' },
  call: { args },
})
let graph = {} as Graph

// What the tool is handed, and a tally of what it asked for.
let fake = (port?: number) => {
  let told = { driven: 0, duties: 0 }
  let stopping = new AbortController()
  let host: Serving = {
    config: { db: 'graph.db', ...(port == null ? {} : { port }) },
    handler: () => new Response('ok'),
    runner: {
      drive: (opts?: { redrive?: boolean }) => {
        told.driven += opts?.redrive ? 1 : 0
        return Promise.resolve([])
      },
    } as unknown as Runner,
    duties: (signal?: AbortSignal) => {
      told.duties += signal ? 0 : 1
      return Promise.resolve()
    },
    stopping: stopping.signal,
  }
  return { host, told, stopping }
}

Deno.test('serve answers with the host handler until the host stops', async () => {
  let port = free()
  let { host, told, stopping } = fake(port)
  let call = runs(host).serve(asked(), graph) as Promise<Bundle[]>
  assertEquals(await said(`http://localhost:${port}`), 'ok')
  // A process that is about to stay up finishes what a crash left claimed,
  // and takes the duties in their long-running form.
  assertEquals(told.driven, 1)
  assertEquals(told.duties, 1)
  stopping.abort()
  let [answer] = await call
  let body = (answer.content as { body: string }).body
  assert(body.includes('http://'), body)
  assert(body.includes(String(port)), body)
})

Deno.test('a host that composed no handler has nothing to serve', async () => {
  // Which is what a config leaving this package out gets: the routes facets
  // are never asked for, and nothing binds a port to refuse every request.
  let { host } = fake(PORT)
  await assertRejects(
    () =>
      runs({ ...host, handler: undefined }).serve(asked(), graph) as Promise<
        Bundle[]
      >,
    Error,
    'compose @yaks/api',
  )
})

Deno.test('the call names the port, over the one the config named', async () => {
  assertEquals(PORT, 8787)
  let port = free()
  // The config names one port and the call another: the call wins.
  let { host, stopping } = fake(PORT)
  let call = runs(host).serve(
    asked({ port, hostname: '127.0.0.1' }),
    graph,
  ) as Promise<Bundle[]>
  assertEquals(await said(`http://127.0.0.1:${port}`), 'ok')
  stopping.abort()
  await call
})
