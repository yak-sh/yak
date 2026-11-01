import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { durable } from '../../packages/durable-object/testing.ts'
import type { Item, Model, Request } from '@yaks/model'
import { comp } from '../../packages/graph/testing.ts'
import { platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { operatorStore } from './operator-store.ts'
import { readOperator, runOperator } from './operator.ts'
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
      ...['clerk', 'other'].flatMap((slug) => [
        {
          entity: { eid: `$${slug}` },
          space: { slug, store: slug },
          doc: { title: slug },
        },
        {
          entity: { eid: `$seat-${slug}` },
          member: { person: owner, space: `$${slug}`, role: 'owner' },
        },
      ]),
    ],
  }, { 'x-yak-person': owner, 'x-yak-role': 'owner' })
  let space = (await dir.space('clerk'))!
  let held = { person: owner, role: 'owner' as const, space: space.eid }
  let ctx = operatorContext(env, held, space)
  await TOOLS.find((t) => t.name == 'app_new')!.run(ctx, {
    slug: 'notices',
    title: 'Notices',
  })
  let raw = durable()
  let store = operatorStore(raw)
  return { env, space, held, store, raw }
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
let out = await runOperator(f.store, f.env, f.held, f.space, {
  say:
    'Post a special meeting Thursday at 7 about the road millage in notices.',
}, { model, name: 'test-model', price: { input: 0, output: 0 } })

let history = await readOperator(f.store, out.task)
let ctx = operatorContext(f.env, f.held, f.space)
let { reaching } = await import('./agent.ts')
let { inReach } = await import('./declared.ts')
let g = await reaching(ctx, await inReach(ctx))
let docs = await g.read('.doc ?created *')
let tasks = await g.read('.task&*')
let other = await ctx.dir.space('other')

test('the operator edits app rows through agent tools and records its work privately', () => {
  let posted = docs.find((b) => b.entity.eid == eid)
  let created = comp(posted, 'created')
  assertEquals(out.status, 'settled')
  assertStringIncludes(out.text, 'notice is posted')
  assertEquals(out.cost, 0.005)
  assertEquals(comp(history.task, 'task').status, 'done')
  assertEquals(history.comments?.length, 1)
  assertEquals(history.entries?.filter((b) => b.call).length, 4)
  let tools = asked[0].tools.map((t) => t.name)
  assertEquals(tools.includes('graph_query'), true)
  assertEquals(posted?.doc, {
    title: 'Special meeting Thursday at 7: road millage',
  })
  assertEquals(created.by, f.space.eid)
  assertEquals(created.via, out.session)
  assertEquals(tasks.length, 0)
  assertEquals(other, null)
})

let continued = await runOperator(f.store, f.env, f.held, f.space, {
  task: out.task,
  say: 'Schedule another meeting.',
}, {
  name: 'test-model',
  price: { input: 0, output: 0 },
  model: (req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Which date and time?' }],
      cost: 0.001,
    }),
})
let clarified = await readOperator(f.store, out.task)
test('a follow-up reopens completed work and a clarification leaves it open', () => {
  assertEquals(continued.status, 'settled')
  assertEquals(comp(clarified.task, 'task').status, 'open')
  assertStringIncludes(continued.text, 'Which date')
})

let rounds = 0
let pastTwelve = await runOperator(f.store, f.env, f.held, f.space, {
  say: 'Inspect the app.',
}, {
  name: 'test-model',
  price: { input: 0, output: 0 },
  model: (req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: ++rounds < 14
        ? calls('graph_query', { q: '.doc&.limit=1' })
        : [{ kind: 'assistant', text: 'Inspected.' }],
      cost: 0.001,
    }),
})
test('the space budget, rather than twelve model rounds, bounds the operator', () => {
  assertEquals(rounds, 14)
  assertEquals(pastTwelve.status, 'settled')
})
