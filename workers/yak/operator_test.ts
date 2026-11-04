import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Model, Request } from '@yaks/model'
import { comp } from '../../packages/graph/testing.ts'
import { platform } from './directory-probe.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { directoryOf } from './directory.ts'
import { operating, readOperator } from './operator.ts'
import { conversations, frameOf } from './operator-host.ts'
import { TOOLS } from './tools.ts'
import { operatorContext } from './operator.ts'
import { ServingCopy, type ServingCopyState } from './serving-copy.ts'
import type { ServingCopyDoor } from './directory-copy.ts'

let owner = crypto.randomUUID()
let fixture = async () => {
  let saved: ServingCopyState | undefined
  let copy = new ServingCopy({
    persistence: {
      read: () => saved,
      write: (next) => void (saved = next),
    },
  })
  let rpc: ServingCopyDoor = {
    begin: (floor) => Promise.resolve(copy.begin(floor)),
    finish: (revision) => Promise.resolve(copy.finish(revision)),
    revision: () => Promise.resolve(copy.revision),
    settle: (revision, committed) =>
      Promise.resolve(copy.settle(revision, committed)),
    put: (...args) => Promise.resolve(copy.put(...args)),
    get: (key) => Promise.resolve().then(() => copy.get(key)),
    valid: (revision) => Promise.resolve(copy.valid(revision)),
    publish: (...args) => Promise.resolve(copy.publish(...args)),
  }
  let { env } = platform('operator-test', {
    SERVING_COPY: { idFromName: (name) => name, get: () => rpc },
  })
  let dir = directoryOf(env.STORE)
  await dir.apply({
    entities: [
      { entity: { eid: owner }, person: {} },
      ...[
        ['clerk', 'owner'],
        ['other', 'owner'],
        ['home', 'owner', true],
        ['peek', 'viewer'],
      ].flatMap(([slug, role, own]) => [
        {
          entity: { eid: `$${slug}` },
          space: { slug, store: slug },
          doc: { title: slug },
        },
        {
          entity: { eid: `$seat-${slug}` },
          member: {
            person: owner,
            space: `$${slug}`,
            role,
            ...own ? { own } : {},
          },
        },
      ]),
    ],
  }, { 'x-yak-person': owner, 'x-yak-role': 'owner' })
  let space = (await dir.space('clerk'))!
  let held = { person: owner, role: 'owner' as const, space: space.eid }
  let ctx = await operatorContext(env, held, space)
  await TOOLS.find((t) => t.name == 'app_new')!.run(ctx, {
    slug: 'notices',
    title: 'Notices',
  })
  await TOOLS.find((t) => t.name == 'app_files')!.run(ctx, {
    app: 'notices',
    files: [
      { path: 'index.html', content: '<h1>Notices</h1>' },
      {
        path: 'vocab.json',
        content: JSON.stringify({
          $defs: {
            meeting: {
              properties: {
                subject: { type: 'string' },
                at: { type: 'string' },
              },
            },
          },
        }),
      },
    ],
  })
  await TOOLS.find((t) => t.name == 'app_deploy')!.run(ctx, { app: 'notices' })
  let store = operatorMemory()
  return { env, space, held, store }
}
let f = await fixture()
let calls = (
  name: string,
  args: unknown,
): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let eid = crypto.randomUUID()
let script = [
  calls('graph_schema', { component: 'doc' }),
  calls('graph_query', { q: '.doc&*' }),
  calls('graph_apply', {
    bundles: [{
      entity: { eid },
      doc: { title: 'Special meeting Thursday at 7: road millage' },
    }],
  }),
  calls('command', {
    name: 'add_meeting',
    app: 'notices',
    args: {
      title: 'Road millage',
      subject: 'Road millage',
      at: 'November 5, 2026 at 7 pm America/Detroit',
    },
  }),
  [{
    kind: 'assistant',
    text: 'The special meeting notice is posted.',
  } as Item],
]
let asked: Request[] = []
let finished = false
let model: Model = async (req) => {
  asked.push(req)
  if (script.length == 1 && !finished) {
    finished = true
    let task = (await f.store.g.read('.task'))[0].entity.eid
    script.unshift(calls('task_update', { task, status: 'done' }))
  }
  return Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: script.shift()!,
    cost: 0.001,
    usage: { input_tokens: 10, output_tokens: 5 },
  })
}
let answer = model
let operator = operating(f.store, f.env, operatorModel((req) => answer(req)))
let out = await operator.run(f.held, f.space, {
  say:
    'Post a special meeting Thursday at 7 about the road millage in notices.',
})

let history = await readOperator(f.store, out.task)
let drawn = await conversations(f.store, '/manage/clerk/operator')
test('the Operator page draws a task as its session ran: the words, each tool with what it sent and got, and the reply', () => {
  assertStringIncludes(drawn.html, 'Chat_Bubble-you">Post a special meeting')
  assertStringIncludes(drawn.html, '✓ graph_schema')
  assertStringIncludes(drawn.html, '&quot;component&quot;: &quot;doc&quot;')
  assertStringIncludes(drawn.html, 'notice is posted')
  assertEquals(drawn.html.includes('data-pending'), false)
  assertEquals(drawn.waiting.length, 0)
})
let ctx = await operatorContext(f.env, f.held, f.space)
let { reaching } = await import('./agent.ts')
let { inReach } = await import('./declared.ts')
let g = await reaching(ctx, await inReach(ctx))
let docs = await g.read('.doc ?created *')
let meetings = await g.read('.meeting ?created *')
let tasks = await g.read('.task&*')
let other = await ctx.dir.space('other')

test('the operator edits app rows through agent tools and records its work privately', () => {
  let posted = docs.find((b) => b.entity.eid == eid)
  let created = comp(posted, 'created')
  assertEquals(out.status, 'settled')
  assertStringIncludes(out.text, 'notice is posted')
  assertEquals(out.cost, 0.006)
  assertEquals(comp(history.task, 'task').status, 'done')
  assertEquals(comp(history.task, 'completed').by, f.space.eid)
  assertEquals(history.comments?.length, 1)
  assertEquals(history.entries?.filter((b) => b.call).length, 5)
  let tools = asked[0].tools.map((t) => t.name)
  assertEquals(tools.includes('graph_query'), true)
  assertEquals(posted?.doc, {
    title: 'Special meeting Thursday at 7: road millage',
  })
  assertEquals(created.by, f.space.eid)
  assertEquals(created.via, out.session)
  assertEquals(comp(meetings[0], 'created').by, f.space.eid)
  assertEquals(comp(meetings[0], 'created').via, out.session)
  assertEquals(tasks.length, 0)
  assertEquals(other, null)
  assertEquals(String(asked[0].instructions).includes('assistant'), false)
})

answer = (req) =>
  Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: [{ kind: 'assistant', text: 'Which date and time?' }],
    cost: 0.001,
  })
let continued = await operator.run(f.held, f.space, {
  task: out.task,
  say: 'Schedule another meeting.',
})
let clarified = await readOperator(f.store, out.task)
test('a follow-up reopens completed work and a clarification leaves it open', () => {
  assertEquals(continued.status, 'settled')
  assertEquals(comp(clarified.task, 'task').status, 'open')
  assertStringIncludes(continued.text, 'Which date')
})

let rounds = 0
answer = (req) =>
  Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: ++rounds < 14
      ? calls('graph_query', { q: '.doc&.limit=1' })
      : [{ kind: 'assistant', text: 'Inspected.' }],
    cost: 0.001,
  })
let pastTwelve = await operator.run(f.held, f.space, {
  say: 'Inspect the app.',
})
test('the space budget, rather than twelve model rounds, bounds the operator', () => {
  assertEquals(rounds, 14)
  assertEquals(pastTwelve.status, 'settled')
})

let homeSpace = (await directoryOf(f.env.STORE).space('home'))!
let pa = await operatorContext(
  f.env,
  f.held,
  homeSpace,
)
let paGraph = await reaching(pa, await inReach(pa))
let paMeetings = await paGraph.read('.meeting')
let paAsked: Request[] = []
await operating(
  operatorMemory(),
  f.env,
  operatorModel((req) => {
    paAsked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Your spaces.' }],
      cost: 0.001,
    })
  }),
).run(f.held, homeSpace, { say: 'What can you reach?' })
let refused = await TOOLS.find((t) => t.name == 'app_new')!
  .run(pa, { space: 'peek', slug: 'notes', title: 'Notes' })
  .then(() => null, (e: Error) => e.message)

test("the Operator on a person's own space is their PA, reaching each of their spaces with their role there", () => {
  assertEquals(paMeetings.length, meetings.length)
  assertStringIncludes(refused ?? '', 'peek')
  let told = String(paAsked[0].instructions)
  for (let said of ['clerk (owner)', 'other (owner)', 'peek (viewer)']) {
    assertStringIncludes(told, said)
  }
  assertEquals(told.includes('home ('), false)
})

// A second message while the model is answering the first: one session takes
// both, the second as its next input, and it answers after both.
let steered = operatorMemory()
let steering: Request[] = []
let given: { task: string; session: string } | undefined
let mid: Awaited<ReturnType<typeof frameOf>> = null
let steerer = operating(
  steered,
  f.env,
  operatorModel(async (req) => {
    steering.push(req)
    if (steering.length == 1) {
      mid = await frameOf(steered, given!.session)
      await steerer.ask(f.held, f.space, {
        task: given!.task,
        say: 'Make it Friday instead.',
      })
    }
    return {
      id: crypto.randomUUID(),
      model: req.model,
      items: [{
        kind: 'assistant',
        text: steering.length == 1 ? 'Thursday it is.' : 'Friday it is.',
      }],
      cost: 0.001,
    }
  }),
)
given = await steerer.ask(f.held, f.space, { say: 'Post the meeting.' })
let before = steering.length
let { drain } = await import('./operator-store.ts')
await drain(steered)
let steeredRead = await readOperator(steered, given.task)
test('words given while the Operator works land in its running session, which answers after them', () => {
  assertEquals(before, 0)
  assertEquals(steeredRead.sessions?.length, 1)
  assertEquals(mid?.frame.operator.now, 'Thinking…')
  assertStringIncludes(mid!.frame.operator.rows[0].html, 'Post the meeting.')
  assertEquals(steering.length, 2)
  assertStringIncludes(
    JSON.stringify(steering[1].items),
    'Make it Friday instead.',
  )
  assertEquals(
    steeredRead.comments?.map((b) => comp(b, 'doc').body).at(-1),
    'Friday it is.',
  )
})
