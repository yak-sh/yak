import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Model, Request } from '@yaks/model'
import { comp } from '../../packages/graph/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { appStore } from './directory.ts'
import { stores } from './app-store-probe.ts'
import { operating, readOperator } from './operator.ts'
import { conversationOf, frameOf, workOf } from './operator-host.ts'
import { TOOLS } from './tools.ts'
import { operatorContext } from './operator.ts'
import { ServingCopy, type ServingCopyState } from './serving-copy.ts'
import type { ServingCopyDoor } from './directory-copy.ts'
import { KERNEL } from './meta.ts'
import { appDoc, appVocab } from './vocab.ts'
import { withKinds } from './kinds.ts'
import { declared } from './directory-fixture.ts'

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
  let p = platform('operator-test', {
    SERVING_COPY: { idFromName: (name) => name, get: () => rpc },
  }, { copy: rpc })
  let { env, dir } = p
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
      {
        entity: { eid: '$notices' },
        doc: { title: 'Notices' },
        app: {
          slug: 'notices',
          space: '$clerk',
          version: 1,
          access: 'public',
          store: 'clerk/notices',
        },
        former: { slug: 'notices' },
      },
    ],
  }, { 'x-yak-person': owner, 'x-yak-role': 'owner' })
  let space = (await dir.space('clerk'))!
  let held = { person: owner, role: 'owner' as const, space: space.eid }
  let app = (await dir.app(space, 'notices'))!
  let words = appDoc({
    $defs: {
      meeting: {
        properties: {
          subject: { type: 'string' },
          at: { type: 'string' },
        },
      },
    },
  })
  stores(env, appVocab(words), {
    declaration: words,
    app: { eid: app.eid, mode: 'public', manifest: words },
  })
  let accepted = await appStore(env.STORE, space, app)('/vocab', {
    method: 'POST',
    body: JSON.stringify(words),
  }, KERNEL)
  assertEquals(accepted.status, 200)
  await declared(env, space, app, {
    vocab: words,
    tools: withKinds({}, words, 'clerk/notices'),
  })
  let store = operatorMemory()
  return { env, dir, space, held, store }
}
let operate = (
  store: Parameters<typeof operating>[0],
  p: Pick<ReturnType<typeof platform>, 'env' | 'dir'>,
  options: Parameters<typeof operating>[2],
) => operating(store, p.env, { ...options, directory: () => p.dir })
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
  calls('app_files', { app: 'notices', op: 'list' }),
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
let operator = operate(f.store, f, operatorModel((req) => answer(req)))
let out = await operator.run(f.held, f.space, {
  say:
    'Post a special meeting Thursday at 7 about the road millage in notices.',
})

let history = await readOperator(f.store, out.task)
let drawn = await conversationOf(f.store, '/manage/clerk/operator', out.task)
let work = await workOf(f.store, f.space.eid, f.held.person)
test('the Operator page lists its work in plain words, each opening on a page of its own', () => {
  assertEquals(work.map((w) => [w.open, w.state, w.busy]), [
    [out.task, 'Done', false],
  ])
})
test("a piece of the Operator's work draws its task as its session ran: the words, each tool with what it sent and got in words, and the reply", () => {
  assertStringIncludes(drawn.html, 'Talk_You">Post a special meeting')
  assertStringIncludes(drawn.html, '<summary>Read the schema')
  assertStringIncludes(drawn.html, '<summary>Listed the files of notices')
  assertStringIncludes(drawn.html, '<dt>Component</dt><dd><span>doc</span>')
  assertStringIncludes(drawn.html, 'notice is posted')
  assertEquals(drawn.html.includes('data-pending'), false)
  assertEquals(drawn.task, out.task)
})
let ctx = await operatorContext(f.env, f.held, f.space, () => f.dir)
let { reaching } = await import('./agent.ts')
let { inReach } = await import('./declared.ts')
let g = await reaching(ctx, await inReach(ctx))
let docs = await g.read('.doc ?created *')
let said = await g.read('.content&*')
let meetings = await g.read('.meeting ?created *')
let tasks = await g.read('.task&*')
let other = await ctx.dir.space('other')

test('the operator edits app rows through agent tools and records its work privately', () => {
  let posted = docs.find((b) => b.entity.eid == eid)
  let created = comp(posted, 'created')
  assertEquals(out.status, 'settled')
  assertStringIncludes(out.text, 'notice is posted')
  assertEquals(out.cost, 0.007)
  assertEquals(comp(history.task, 'task').status, 'done')
  assertEquals(comp(history.task, 'completed').by, f.space.eid)
  assertEquals(history.comments?.length, 1)
  assertEquals(history.entries?.filter((b) => b.call).length, 6)
  // A tool that may write answers in words, which are the call's own and
  // never a row in the space's apps.
  let listed = history.entries?.find((b) =>
    (comp(b, 'call')?.args as { op?: string })?.op == 'list'
  )
  assertEquals(comp(listed, 'execution').state, 'done')
  assertEquals(said, [])
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

// Model rounds and concurrent input need a scoped graph, without app storage.
let roundsPlatform = platform('operator-rounds')
let roundsDir = roundsPlatform.dir
let roundsId = await roundsDir.mint(owner, 'rounds', 'Rounds', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let roundsSpace = (await roundsDir.at(roundsId))!
let roundsHeld = { person: owner, role: 'owner' as const, space: roundsId }
let rounds = 0
let pastTwelve = await operate(
  operatorMemory(),
  roundsPlatform,
  operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: ++rounds < 14
        ? calls('graph_query', { q: '.doc&.limit=1' })
        : [{ kind: 'assistant', text: 'Inspected.' }],
      cost: 0.001,
    })
  ),
).run(roundsHeld, roundsSpace, { say: 'Inspect the app.' })
test('the space budget, rather than twelve model rounds, bounds the operator', () => {
  assertEquals(rounds, 14)
  assertEquals(pastTwelve.status, 'settled')
})

let homeSpace = (await f.dir.space('home'))!
let pa = await operatorContext(
  f.env,
  f.held,
  homeSpace,
  () => f.dir,
)
let paGraph = await reaching(pa, await inReach(pa))
let paMeetings = await paGraph.read('.meeting')
let paAsked: Request[] = []
await operate(
  operatorMemory(),
  f,
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
let steerer = operate(
  steered,
  roundsPlatform,
  operatorModel(async (req) => {
    steering.push(req)
    if (steering.length == 1) {
      mid = await frameOf(steered, given!.session)
      await steerer.ask(roundsHeld, roundsSpace, {
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
given = await steerer.ask(roundsHeld, roundsSpace, {
  say: 'Post the meeting.',
}, { task: crypto.randomUUID() })
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

// Stopped while the model answers: the step withdrawn, one answer,
// and new words take the same session up again.
let halted = operatorMemory()
let halting: Request[] = []
let begun: { task: string; session: string } | undefined
let halter = operate(
  halted,
  roundsPlatform,
  operatorModel(async (req) => {
    halting.push(req)
    if (halting.length == 1) await halter.stop(begun!.task, roundsHeld.person)
    return {
      id: crypto.randomUUID(),
      model: req.model,
      items: halting.length == 1
        ? calls('graph_query', { q: '.doc&.limit=1' })
        : [{ kind: 'assistant', text: 'Picked up again.' }],
      cost: 0.001,
    }
  }),
)
begun = await halter.ask(roundsHeld, roundsSpace, {
  say: 'Look at every app.',
}, { task: crypto.randomUUID() })
await drain(halted)
let afterStop = halting.length
let stopRead = await readOperator(halted, begun.task)
let again = await halter.run(roundsHeld, roundsSpace, {
  task: begun.task,
  say: 'Go on.',
})
test('Stop ends the run at once with one answer, and new words reopen the session', () => {
  assertEquals(afterStop, 1)
  assertEquals(
    stopRead.entries?.some((b) => b.stop),
    true,
  )
  assertEquals(stopRead.comments?.length, 1)
  assertEquals(again.session, begun!.session)
  assertEquals(again.text, 'Picked up again.')
})

// A reply streamed: its host is told each piece, for the page watching.
let pieces: [string, string][] = []
let writer = operate(
  operatorMemory(),
  roundsPlatform,
  {
    ...operatorModel((req) => {
      for (let text of ['Posting ', 'it now.']) req.onText?.({ index: 0, text })
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: 'Posting it now.' }],
        cost: 0.001,
      })
    }),
    typing: (session, text) => void pieces.push([session, text]),
  },
)
let written = await writer.run(roundsHeld, roundsSpace, { say: 'Post it.' })
test('the Operator tells its host each piece of a reply as the model writes it', () => {
  assertEquals(pieces, [[written.session, 'Posting '], [
    written.session,
    'it now.',
  ]])
  assertEquals(written.text, 'Posting it now.')
})

// A call's words ask for the model the Operator answers calls with, and the
// next words, asking for none, go back to its own; each step's end is told.
let models: string[] = [], steps: string[] = []
let caller = operate(operatorMemory(), roundsPlatform, {
  ...operatorModel((req) => {
    models.push(req.model)
    req.onText?.({ index: 0, text: 'Hi.' })
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Hi.' }],
      cost: 0.001,
    })
  }),
  name: 'claude-sonnet-5-5',
  stepped: (session) => void steps.push(session),
})
let byCall = await caller.run(roundsHeld, roundsSpace, { say: 'Hello.' }, {
  model: 'claude-haiku-5-5',
})
await caller.run(roundsHeld, roundsSpace, { say: 'Hello again.' }, {
  task: byCall.task,
})
test('words given with a model are answered by it, and the next words by the Operator’s own', () => {
  assertEquals(models, ['claude-haiku-5-5', 'claude-sonnet-5-5'])
  assertEquals(steps, [byCall.session, byCall.session])
})
