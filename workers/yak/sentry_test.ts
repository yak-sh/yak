// A defect reaches Sentry with where it happened and who hit it, and nothing
// a person sent rides along with it.
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

Deno.test('a defect is sent with its tags and the person who hit it', async () => {
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

Deno.test('a connector tool names the tool, space, app, client and account', async () => {
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

Deno.test('a caught failure is sent, and a refusal is not', async () => {
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

Deno.test('what leaves carries no header, query, body or console argument', () => {
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
