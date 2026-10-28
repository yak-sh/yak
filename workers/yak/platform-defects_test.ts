// A defect reaches tracker with where it happened and who hit it, and nothing
// a person sent rides along with it.
import { test as check } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { clock } from '@yaks/testing'
import { type Bundle, type Comp } from '@yaks/graph'
import { Refused, Stale } from '@yaks/graph'
import { CallError } from '@yaks/tools'
import { caught, defect, reporter, within } from './defects.ts'
import type { Ctx } from './tools.ts'
import { type Namespace, storeOf } from './door.ts'

let tagsOf = (row: Bundle) =>
  (row.error as { tags?: Record<string, string> }).tags
type Sample = { seen: Bundle[]; done: () => Promise<void> }
let test = (name: string, run: (sample: Sample) => Promise<void>) =>
  check(name, async () => {
    let seen: Bundle[] = []
    let env = {
      ERRORS: {
        send: (rows: Bundle[]) => {
          seen.push(rows[0])
          return Promise.resolve()
        },
      },
    }
    let time = clock()
    await within(
      env,
      {},
      () => run({ seen, done: () => time.advance(10_000) }),
      time,
    )
  })

let errors = Array.from({ length: 4 }, () => new TypeError('x is undefined'))
let status = (n: number) => Object.assign(new Error(`${n}`), { status: n })
let caughtErrors = [
  new CallError('arguments', 'no'),
  new Refused('no'),
  new Stale('e', 'doc', 'title', null),
  status(404),
  status(503),
  errors[3],
]
// Build exception inputs, including V8's lazy stacks, once per fixture.
for (let error of [...errors, ...caughtErrors]) void error.stack

test('a defect is sent with its tags and the person who hit it', async (s) => {
  let { seen, done } = s
  defect(
    errors[0],
    { tool: 'app_new', space: 'jeff', app: null, client: 'claude-ai' },
    { hit: { id: 'p-1', account: 'test' } },
  )
  await done()
  assertEquals(seen.length, 1)
  assertEquals((seen[0].exception as Comp)?.value, 'x is undefined')
  assertEquals(tagsOf(seen[0]), {
    tool: 'app_new',
    space: 'jeff',
    client: 'claude-ai',
    account: 'test',
    user_id: 'p-1',
  })
  assertEquals(tagsOf(seen[0])?.user_id, 'p-1')
})

test('a connector tool names the tool, space, app, client and account', async (s) => {
  let { seen, done } = s
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
  await reporter(ctx('probe-1@bot.yak.sh'), 'claude-ai')(
    errors[1],
    call,
    'app_new',
  )
  await reporter(ctx('jeff@yak.sh'))(errors[2], call, 'app_new')
  await done()
  assertEquals(seen.map((e) => tagsOf(e)), [
    {
      tool: 'app_new',
      space: 'jeff',
      app: 'recipes',
      client: 'claude-ai',
      account: 'test',
      user_id: 'p-1',
    },
    {
      tool: 'app_new',
      space: 'jeff',
      app: 'recipes',
      account: 'person',
      user_id: 'p-1',
    },
  ])
  assertEquals(tagsOf(seen[0])?.user_id, 'p-1')
})

test('a caught failure is sent, and a refusal is not', async (s) => {
  let { seen, done } = s
  for (let e of caughtErrors) {
    caught(e, { request: 'GET /api/query', space: 'jeff' })
  }
  await done()
  assertEquals(seen.map((e) => (e.exception as Comp)?.value), [
    '503',
    'x is undefined',
  ])
  assertEquals(tagsOf(seen[1]), { request: 'GET /api/query', space: 'jeff' })
})

// A store the runtime kills for its limits never runs a line that could report
// it: the kernel's door does, and the alarm's retry does.
test('a store killed for its limits is reported, though the retry answers', async (s) => {
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
  // Its resend waits out no pause.
  let door = storeOf(ns, 'ada/notes', undefined, () => Promise.resolve())
  assertEquals(await (await door('/query?q=private')).text(), 'ok')
  await s.done()
  assertEquals(s.seen.map((e) => tagsOf(e)), [
    { request: 'store /query', store: 'ada/notes' },
  ])
})
