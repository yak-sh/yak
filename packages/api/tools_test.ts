/// <reference lib="deno.ns" />
// The `serve` tool, over a host written here: no database, no plugins, just
// the four things it reads off the host it was composed into.

import { test, until } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  type Graph,
  graph as memory,
  type Tool,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  callDoc,
  CallError,
  reconcile,
  type Runner,
  runner,
  toolDoc,
  toolEid,
} from '@yaks/tools'
import { PORT, runs, type Serving } from './tools.ts'

// A port this box is not using, asked for and given back.
let free = (): number => {
  let l = Deno.listen({ port: 0 })
  let { port } = l.addr as Deno.NetAddr
  l.close()
  return port
}

// Wait for the listener rather than count startup ticks. Each ask is a
// connection of its own, so servers sharing a port each get their turn.
let said = async (url: string, ms = 2000): Promise<string> => {
  let end = Date.now() + ms
  for (;;) {
    try {
      let init = { headers: { connection: 'close' } }
      return await fetch(url, init).then((r) => r.text())
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
let fake = (
  port?: number,
  handler: (request: Request) => Response | Promise<Response> = () =>
    new Response('ok'),
) => {
  let told = { driven: 0, duties: 0 }
  let stopping = new AbortController()
  let host: Serving = {
    config: { db: 'graph.db', ...(port == null ? {} : { port }) },
    handler,
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

test('serve answers with the host handler until the host stops', async () => {
  let port = free()
  let { host, told, stopping } = fake(port)
  let call = runs(host).serve(asked(), graph) as Promise<Bundle[]>
  assertEquals(await said(`http://127.0.0.1:${port}`), 'ok')
  assertEquals(told.driven, 0)
  assertEquals(told.duties, 1)
  stopping.abort()
  let [answer] = await call
  let body = (answer.content as { body: string }).body
  // Named nowhere, the interface is this machine's own.
  assert(body.includes(`http://127.0.0.1:${port}`), body)
})

test('a stop cuts what is still in flight once its grace is up', async () => {
  let port = free()
  let asking = Promise.withResolvers<void>()
  let { host, stopping } = fake(port, (request) => {
    if (!request.url.endsWith('/hang')) return new Response('ok')
    asking.resolve()
    return new Promise<Response>(() => {})
  })
  let stopped = false
  let call = (runs(host).serve(asked({ grace: 0.01 }), graph) as Promise<
    Bundle[]
  >).then(([answer]) => (stopped = true, answer))
  await said(`http://127.0.0.1:${port}`)
  let client = new AbortController()
  let hung = fetch(`http://127.0.0.1:${port}/hang`, { signal: client.signal })
    .catch(() => {})
  try {
    await asking.promise
    stopping.abort()
    await until(() => stopped, { label: 'serve to stop over a hung request' })
    let body = (await call).content as { body: string }
    assert(body.body.includes('cutting what was open'), body.body)
  } finally {
    client.abort()
    await hung
  }
})

test('servers sharing a port hand it over without a refusal', async () => {
  let port = free()
  let dir = await Deno.makeTempDir()
  let ready = `${dir}/ready`
  let serving = (name: string, args = {}) => {
    let { host, stopping } = fake(port, () => new Response(name))
    let call = runs(host).serve(asked({ share: true, ...args }), graph)
    return { stopping, call: call as Promise<Bundle[]> }
  }
  let old = serving('old')
  let next = serving('next', { ready })
  try {
    // Both answer while both listen, and the newer says when it does.
    let heard = new Set<string>()
    await until(
      async () => heard.add(await said(`http://127.0.0.1:${port}`)).size == 2,
      {
        label: 'both servers answering',
      },
    )
    assertEquals(await Deno.readTextFile(ready), `${Deno.pid}\n`)
    old.stopping.abort()
    await old.call
    for (let i = 0; i < 20; i++) {
      assertEquals(await said(`http://127.0.0.1:${port}`), 'next')
    }
  } finally {
    old.stopping.abort()
    next.stopping.abort()
    await Promise.all([old.call, next.call])
    await assertRejects(() => Deno.stat(ready), Deno.errors.NotFound)
    await Deno.remove(dir, { recursive: true })
  }
})

test('a host that composed no handler has nothing to serve', async () => {
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

test('an address in use is refused without starting duties', async () => {
  let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (listener.addr as Deno.NetAddr).port
  try {
    let { host, told } = fake(port)
    let error = await assertRejects(
      () => runs(host).serve(asked(), graph) as Promise<Bundle[]>,
      CallError,
      `${port} is already in use`,
    )
    assertEquals(error.code, 'address')
    assertEquals(told.duties, 0)
  } finally {
    listener.close()
  }
})

test('the call names the port, over the one the config named', async () => {
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

test('a slow queued runner cannot block listening or stopping', async () => {
  let vocab = loadVocab([callDoc, toolDoc])
  let queued = memory({ vocab, storage: ram(vocab) })
  let gate = Promise.withResolvers<void>()
  let started = false
  let finished = false
  let slow: Tool = {
    noun: 'example',
    verb: 'slow',
    description: 'Wait for release',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      started = true
      await gate.promise
      finished = true
      return []
    },
  }
  let recovery = runner(queued, {
    tools: [slow],
    report: (error) => {
      throw error
    },
  })
  await recovery.ensure()
  await queued.apply([{
    entity: { eid: 'queued' },
    call: { to: toolEid('example_slow'), args: {} },
    execution: { state: 'running' },
  }])
  let port = free()
  let { host, stopping } = fake(port)
  let stopped = false
  let call =
    (runs({ ...host, runner: recovery }).serve(asked(), queued) as Promise<
      Bundle[]
    >).then((answer) => {
      stopped = true
      return answer
    })
  try {
    assertEquals(await said(`http://127.0.0.1:${port}`), 'ok')
    stopping.abort()
    await until(() => stopped, {
      label: 'serve to stop with recovery unreleased',
    })
    assertEquals(started, false)
    assertEquals(finished, false)
    // The queued call really does wait; recovery can run independently after
    // the listener has stopped, without web having consumed the queue.
    let work = reconcile(recovery)
    try {
      await until(() => started, { label: 'queued tool to start' })
      assertEquals(finished, false)
    } finally {
      gate.resolve()
      await work
    }
    assertEquals(finished, true)
  } finally {
    gate.resolve()
    stopping.abort()
    await call
  }
})
