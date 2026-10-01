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

// Wait for the listener rather than count startup ticks.
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
