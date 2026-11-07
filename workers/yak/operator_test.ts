import { test, until } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { CallError } from '@yaks/tools'
import { rootOf } from './operator-channels.ts'
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
import { trashSpace } from './erase.ts'

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
let listing = await readOperator(f.store)
let talked = await readOperator(f.store, out.session)
let drawn = await conversationOf(f.store, '/manage/clerk/operator', out.task)
let work = await workOf(f.store, f.space.eid, f.held.person)
test('operator_read lists the conversations and reads one by its session, as its task reads it', () => {
  assertEquals(listing.conversations?.map((b) => b.entity.eid), [out.session])
  assertEquals(talked.entries, history.entries)
})
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
  assertEquals(
    String(asked[0].instructions).includes('their personal assistant'),
    false,
  )
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
  assertStringIncludes(told, 'their personal assistant')
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

// Words given while a tool runs: the step after it sees them and does what
// they say, in the same session, with no run queued behind it.
let toolSteered = operatorMemory()
let toolSteering: Request[] = []
let toolGiven: { task: string; session: string } | undefined
let painter = operate(toolSteered, roundsPlatform, {
  ...operatorModel((req) => {
    toolSteering.push(req)
    let heard = JSON.stringify(req.items).includes('No, warmer colors.')
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: toolSteering.length == 1 ? calls('paint', { colors: 'cool' }) : [{
        kind: 'assistant',
        text: heard ? 'Repainting it warm.' : 'Painted it cool.',
      }],
      cost: 0.001,
    })
  }),
  tools: () => [{
    name: 'paint',
    title: 'Paint the app',
    description: 'Paint the app in the colors given.',
    parameters: { type: 'object', properties: { colors: { type: 'string' } } },
    run: async () => {
      await painter.ask(roundsHeld, roundsSpace, {
        task: toolGiven!.task,
        say: 'No, warmer colors.',
      })
      return 'painted'
    },
  }],
})
toolGiven = await painter.ask(roundsHeld, roundsSpace, {
  say: 'Paint the notices app.',
}, { task: crypto.randomUUID() })
await drain(toolSteered)
let toolRead = await readOperator(toolSteered, toolGiven.task)
test('words given during a tool call change what the running turn does next', () => {
  assertEquals(toolRead.sessions?.length, 1)
  assertEquals(toolSteering.length, 2)
  assertEquals(
    toolRead.comments?.map((b) => comp(b, 'doc').body).at(-1),
    'Repainting it warm.',
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

// A reply streamed: its host is told each piece once the transcript keeps it,
// so what a page shows of a reply is what survives the object.
let pieces: [string, string][] = [], kept: unknown[] = []
let streamed = operatorMemory()
let keeping = async (call?: string) => {
  let [line] = await streamed.g.read(`.output.source=${call}&*`, {
    durable: true,
  })
  kept.push(comp(line, 'content')?.body)
}
let writer = operate(streamed, roundsPlatform, {
  ...operatorModel(async (req) => {
    req.onText?.({ index: 0, text: 'Posting ' })
    await until(() => pieces.length == 1)
    await keeping(req.call)
    req.onText?.({ index: 0, text: 'it now.' })
    await until(() => pieces.length == 2)
    await keeping(req.call)
    return {
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Posting it now.' }],
      cost: 0.001,
    }
  }),
  typing: (session, text) => void pieces.push([session, text]),
})
let written = await writer.run(roundsHeld, roundsSpace, { say: 'Post it.' })
test('the Operator tells its host each piece of a reply once it is stored', () => {
  assertEquals(pieces, [[written.session, 'Posting '], [
    written.session,
    'it now.',
  ]])
  assertEquals(kept, ['Posting ', 'Posting it now.'])
  assertEquals(written.text, 'Posting it now.')
})

// A deploy resets the object under a reply: the next incarnation, over the
// same rows, keeps what was shown and takes the turn up again.
let shown: string[] = []
let resetting = operatorMemory()
let dying = operate(resetting, roundsPlatform, {
  ...operatorModel((req) => {
    req.onText?.({ index: 0, text: 'Got it, ' })
    // Never answered: the object it was asked from is gone.
    return new Promise(() => {})
  }),
  typing: (_, text) => void shown.push(text),
})
let cut = await dying.ask(roundsHeld, roundsSpace, { say: 'Set the icon.' })
void drain(resetting)
await until(() => shown.length)
let incarnation = operatorMemory(resetting.storage)
operate(
  incarnation,
  roundsPlatform,
  operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'The icon is set.' }],
      cost: 0.001,
    })
  ),
)
await drain(incarnation)
let resumed = (await incarnation.g.read(`.entry.session=${cut.session}&*`, {
  durable: true,
})).map((b) => comp(b, 'content')?.body).filter(Boolean)
test('a reply a reset cut off keeps the words it showed, and its turn is taken up again', () => {
  assertEquals(shown, ['Got it, '])
  assertEquals(resumed.includes('Got it, '), true)
  assertEquals(resumed.at(-1), 'The icon is set.')
})

// A reset under a tool call that never returned: the next incarnation answers
// the call as interrupted and the turn goes on, rather than the session
// staying running with nobody to finish it (Jeff's app_preview, T-145961).
// `finished` is the call's own run having ended before the reset was seen,
// as Jeff's did under the code before: only the incarnation's start-up finds
// it then (T-146044).
let preview = (run: () => Promise<string>) => () => [{
  name: 'preview',
  title: 'Preview the app',
  description: 'Preview the app.',
  parameters: { type: 'object', properties: {} },
  run,
}]
let cutOff = async (finished: boolean) => {
  let hung = operatorMemory()
  let hanging = false
  let frozen = operate(hung, roundsPlatform, {
    ...operatorModel((req) =>
      Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: calls('preview', {}),
        cost: 0.001,
      })
    ),
    tools: preview(() => {
      hanging = true
      return new Promise(() => {})
    }),
  })
  let stalled = await frozen.ask(roundsHeld, roundsSpace, {
    say: 'Preview it.',
  })
  void drain(hung)
  await until(() => hanging)
  let reborn = operatorMemory(hung.storage)
  if (finished) {
    let runs = await reborn.g.read('.effect.handler=session_tool')
    await reborn.g.apply(
      runs.map((b) => ({ entity: b.entity, $delete: true })),
      { trusted: true },
    )
  }
  let retold: string[] = []
  operate(reborn, roundsPlatform, {
    ...operatorModel((req) => {
      retold.push(JSON.stringify(req.items))
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: 'The preview was cut off.' }],
        cost: 0.001,
      })
    }),
    tools: preview(() => Promise.resolve('previewed')),
  })
  await drain(reborn)
  let after = (await reborn.g.read(`.entry.session=${stalled.session}&*`, {
    durable: true,
  })).map((b) => comp(b, 'content')?.body).filter(Boolean)
  return { retold: retold.join(), said: after.at(-1) }
}
let reset = await cutOff(false), left = await cutOff(true)
test('a tool call a reset cut off is answered as interrupted, and its turn goes on', () => {
  assertStringIncludes(reset.retold, 'Tool execution was interrupted')
  assertEquals(reset.said, 'The preview was cut off.')
})
test('a call whose run ended under a gone holder is taken up as the next incarnation starts', () => {
  assertStringIncludes(left.retold, 'Tool execution was interrupted')
  assertEquals(left.said, 'The preview was cut off.')
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

// Helpers forking helpers: Stop on the conversation reaches every one of
// them, however deep, and the conversation waiting on them stops too.
let deep = operatorMemory()
let deeper = operate(
  deep,
  roundsPlatform,
  operatorModel(() => Promise.reject(new Error('no model here'))),
)
let line = (session: string) => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session },
  content: { body: 'Check the draft.' },
})
let [top, child, grandchild] = [0, 1, 2].map(() => crypto.randomUUID())
await deep.g.apply([
  { entity: { eid: top }, session: { id: top } },
  { entity: { eid: child }, session: { id: child }, spawned: { parent: top } },
  {
    entity: { eid: grandchild },
    session: { id: grandchild },
    spawned: { parent: child },
  },
  ...[child, grandchild].map(line),
], { trusted: true })
let deepStop = await deeper.stop(top, roundsHeld.person)
let stops = await deep.g.read('.stop&.entry')
test('Stop reaches a helper a helper started', () => {
  assertEquals(deepStop.stopped, true)
  assertEquals(
    new Set(stops.map((b) => comp(b, 'entry').session)),
    new Set([top, child, grandchild]),
  )
})

test('another model working for a person is offered the tools their conversation is, and runs them through the same reach', async () => {
  let store = operatorMemory()
  let op = operate(store, f, operatorModel(() => Promise.reject('no model')))
  let { tools, run } = await op.tools(f.held, f.space)
  let names = tools.map((t) => t.name)
  for (let name of ['graph_query', 'graph_apply', 'wake_set', 'text_send']) {
    assertEquals(names.includes(name), true, name)
  }
  // Starting a helper is the conversation's own.
  assertEquals(names.includes('fork'), false)
  assertEquals(
    await run('app_files', { app: 'notices', op: 'list' }),
    '(no files)\nNothing is released yet.',
  )
  await assertRejects(() => run('nope', {}), CallError, 'no tool called nope')
  // Their conversation is begun for the calls to be its own.
  let root = rootOf(f.space.eid, f.held.person)
  assertEquals((await store.g.get([root]))[0]?.session != undefined, true)
})

test('the Operator of a space in the trash asks no model', async () => {
  let eid = crypto.randomUUID()
  await f.dir.apply({
    entities: [
      {
        entity: { eid },
        space: { slug: 'binned', store: 'binned' },
        doc: { title: 'binned' },
      },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person: owner, space: eid, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': owner, 'x-yak-role': 'owner' })
  let held = { ...f.held, space: eid }
  await trashSpace(f.env, f.dir, (await f.dir.space('binned'))!, held)
  let binned = (await f.dir.space('binned'))!
  let asked = 0
  let op = operate(
    operatorMemory(),
    f,
    operatorModel(() => {
      asked++
      return Promise.reject('no model')
    }),
  )
  await op.run(held, binned, { say: 'A plant watering log' }).catch(() => {})
  assertEquals(asked, 0)
})
