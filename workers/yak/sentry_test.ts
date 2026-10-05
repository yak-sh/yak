// A defect reaches Sentry with where it happened and who hit it, and nothing
// a person sent rides along with it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  createTransport,
  type ErrorEvent,
  ServerRuntimeClient,
  setCurrentClient,
} from '@sentry/core'
import { Refused, Stale } from '@yaks/graph'
import { CallError } from '@yaks/tools'
import { caught, defect, reporter, scrub } from './sentry.ts'
import type { Ctx } from './tools.ts'
import { doorOf, type Namespace, storeOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import { state } from './testing.ts'
import { connector, fresh, txt, vocabFile } from './probe.ts'

// A client that keeps what it would have sent.
let sentry = () => {
  let seen: ErrorEvent[] = []
  let client = new ServerRuntimeClient({
    dsn: 'https://key@example.ingest.sentry.io/1',
    integrations: [],
    stackParser: () => [],
    transport: (o) => createTransport(o, () => Promise.resolve({})),
    beforeSend: (e) => {
      seen.push(e)
      return null
    },
  })
  setCurrentClient(client)
  client.init()
  return { seen, done: () => client.flush(1000) }
}

test('an interrupted store body leaves no rows or queued write and reports no defect', async () => {
  let s = sentry()
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), 'ada/notes')
  await door('/vocab', { method: 'POST', body: '{}' }, KERNEL)
  let eid = crypto.randomUUID()
  for (let path of ['/apply', '/apply?check=1', '/vocab']) {
    let sent = false
    let stream = new ReadableStream<Uint8Array>({
      pull: (c) => {
        if (!sent) {
          sent = true
          c.enqueue(new TextEncoder().encode(JSON.stringify([{
            entity: { eid },
            doc: { title: 'Interrupted upload' },
          }])))
        } else {
          c.error(
            new TypeError(
              "Can't read from request stream because client disconnected.",
            ),
          )
        }
      },
    })
    let response = await door(path, { method: 'POST', body: stream }, KERNEL)
    assertEquals(response.status, 400)
    assertEquals((await response.json()).error, 'Refused')
  }
  assertEquals(await metaOf(door).query(`.entity.eid=${eid}`), [])
  assertEquals(await (await door('/writes', {}, KERNEL)).json(), [])
  await s.done()
  assertEquals(s.seen, [])
})

test('a defect is sent with its tags and the person who hit it', async () => {
  let { seen, done } = sentry()
  defect(
    new TypeError('x is undefined'),
    { tool: 'app_new', space: 'jeff', app: null, client: 'claude-ai' },
    { id: 'p-1', account: 'test' },
  )
  await done()
  assertEquals(seen.length, 1)
  assertEquals(seen[0].exception?.values?.[0].value, 'x is undefined')
  assertEquals(seen[0].tags, {
    tool: 'app_new',
    space: 'jeff',
    client: 'claude-ai',
    account: 'test',
  })
  assertEquals(seen[0].user, { id: 'p-1' })
})

test('a connector tool names the tool, space, app, client and account', async () => {
  let { seen, done } = sentry()
  let ctx = (email: string) =>
    ({
      person: 'p-1',
      dir: { emailAt: () => Promise.resolve(email) },
    }) as unknown as Ctx
  let call = {
    entity: { eid: 'c' },
    call: {
      to: 't',
      args: { space: 'jeff', app: 'recipes', text: 'secret' },
    },
  }
  let broke = () => new TypeError('x is undefined')
  await reporter(ctx('probe-1@bot.yak.sh'), 'claude-ai')(
    broke(),
    call,
    'app_new',
  )
  await reporter(ctx('jeff@yak.sh'))(broke(), call, 'app_new')
  await done()
  assertEquals(seen.map((e) => e.tags), [
    {
      tool: 'app_new',
      space: 'jeff',
      app: 'recipes',
      client: 'claude-ai',
      account: 'test',
    },
    { tool: 'app_new', space: 'jeff', app: 'recipes', account: 'person' },
  ])
  assertEquals(seen[0].user, { id: 'p-1' })
})

test('a caught failure is sent, and a refusal is not', async () => {
  let { seen, done } = sentry()
  let status = (n: number) => Object.assign(new Error(`${n}`), { status: n })
  for (
    let e of [
      new CallError('arguments', 'no'),
      new Refused('no'),
      new Stale('e', 'doc', 'title', null),
      status(404),
      status(503),
      new TypeError('x is undefined'),
    ]
  ) caught(e, { request: 'GET /api/query', space: 'jeff' })
  await done()
  assertEquals(seen.map((e) => e.exception?.values?.[0].value), [
    '503',
    'x is undefined',
  ])
  assertEquals(seen[1].tags, { request: 'GET /api/query', space: 'jeff' })
})

test('what leaves carries no header, query, body or console argument', () => {
  let event = scrub({
    type: undefined,
    request: {
      url: 'https://yaks.app/oauth/callback?code=secret',
      method: 'GET',
      headers: { cookie: 'yak=secret', authorization: 'Bearer secret' },
      query_string: 'code=secret',
      data: '{"text":"hello"}',
    },
    extra: { arguments: ['POST /apply failed —', 'secret'] },
  })
  assertEquals(event.request, {
    url: 'https://yaks.app/oauth/callback',
    method: 'GET',
  })
  assertEquals(event.extra, {})
})

// A store the runtime kills for its limits never runs a line that could report
// it: the kernel's door does, and the alarm's retry does.
test('a store killed for its limits is reported, though the retry answers', async () => {
  let s = sentry()
  let answers: (Error | Response)[] = [
    Object.assign(
      new Error('Durable Object exceeded its CPU time limit and was reset.'),
      { retryable: true },
    ),
    new Response('ok'),
  ]
  let ns: Namespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: () => {
        let next = answers.shift()!
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(next)
      },
    }),
  }
  let door = storeOf(ns, 'ada/notes')
  assertEquals(await (await door('/query?q=private')).text(), 'ok')
  await s.done()
  assertEquals(s.seen.map((e) => e.tags), [
    { request: 'store /query', store: 'ada/notes' },
  ])
})

test("a store's alarm the runtime cut off is reported by its retry", async () => {
  let s = sentry()
  let o = new Store(state(), {})
  let door = doorOf((r) => o.fetch(r), 'ada/notes')
  await door('/vocab', { method: 'POST', body: '{}' }, KERNEL)
  await o.alarm({ isRetry: true, retryCount: 1 })
  await o.alarm()
  await s.done()
  assertEquals(
    s.seen.filter((e) => e.tags?.request == 'alarm').map((e) => e.tags),
    [{ request: 'alarm', store: 'ada/notes', retry: '1' }],
  )
})

test('signed-in MCP discovery faults before a tool runs reach Sentry with the request id', async () => {
  let failing = false
  let k = await fresh({}, (env) => {
    let get = env.BLOBS.get.bind(env.BLOBS)
    env.BLOBS.get = (...args) => {
      if (failing) {
        throw new CallError(
          'arguments',
          'vocab.json: fight.dealt is already text',
        )
      }
      return get(...args)
    }
  })
  try {
    let agent = connector(k, k.owner.cookie)
    let made = await agent.tool('app_new', { slug: 'notes', title: 'Notes' })
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/.exec(made)![1]
    await agent.tool('app_files', {
      space,
      app: 'notes',
      files: [{
        path: 'vocab.json',
        content: vocabFile({ note: { body: txt } }),
      }],
    })
    await agent.tool('app_deploy', { space, app: 'notes' })
    let captured = sentry()
    failing = true
    for (let method of ['initialize', 'tools/list', 'tools/call']) {
      let response = await k.at(k.host, '/mcp', {
        method: 'POST',
        headers: { cookie: k.owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: method == 'tools/call'
            ? { name: 'app_list', arguments: {} }
            : {},
        }),
      })
      assertEquals(response.status, 500)
      let requestId = response.headers.get('x-request-id')
      await response.body?.cancel()
      await captured.done()
      let event = captured.seen.at(-1)!
      assertEquals(
        event.exception?.values?.[0].value,
        'Release discovery failed: vocab.json: fight.dealt is already text',
      )
      assertEquals(event.tags?.request, `POST ${k.host}/mcp`)
      assertEquals(event.tags?.request_id, requestId)
    }
    assertEquals(captured.seen.length, 3)
  } finally {
    failing = false
    await k.stop()
  }
})
