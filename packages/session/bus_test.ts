// An addressed item reaches a native transcript as input, and an outside
// caller as a reply, through the graph interfaces both use.

import { assertEquals } from '@std/assert'
import { type Bundle, type Graph, graph, type Storage } from '@yaks/graph'
import { processDoc } from '@yaks/process'
import { kernelDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { effects } from '@yaks/effects'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { test, until } from '@yaks/testing'
import { due, feed, heard, reply } from './bus.ts'
import { pendingItems } from './listen.ts'
import { statusOf } from './state.ts'
import { sessionDoc } from './comp.ts'
import { sessionDerived, statusComputed } from './status.ts'
import { sessions } from './plugin.ts'
import { service } from './service.ts'
import { preparedStore } from '../sqlite/testing.ts'

let vocab = loadVocab([
  kernelDoc,
  processDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  personaDoc,
  projectDoc,
  sessionDoc,
  toolsDoc,
])
let memory = () => ram(vocab, { computed: statusComputed })
let derived = sessionDerived(vocab)
let lite = () => preparedStore(vocab, { derived })
let bare = (store: Storage = memory(), woke?: (eid: string) => void) => {
  let fx = effects(vocab)
  fx.handle({ session_run: (e) => woke?.(e.entity.eid) })
  return graph({ vocab, storage: store, plugins: [sessions(), fx] })
}
// What a test starts from, applied through the graph once as the module loads,
// and the rows it left laid into a store of each test's own.
let image = async (...batches: Bundle[][]): Promise<Bundle[]> => {
  let g = bare()
  let rows: Bundle[] = []
  for (let b of batches) rows.push(...await g.apply(b, { trusted: true }))
  return rows
}
let laid = (rows: Bundle[], store: Storage = memory()) => {
  store.tx((tx) => tx.patch(rows))
  return store
}
let fresh = async (
  store: Storage = memory(),
  woke?: (eid: string) => void,
) => {
  let g = bare(store, woke)
  await g.apply([
    { entity: { eid: 'native' }, session: { id: 'native' } },
    { entity: { eid: 'outside' }, session: { id: 'outside' } },
    {
      entity: { eid: 'start' },
      entry: { session: 'native' },
      content: { body: 'start' },
      using: {},
    },
    {
      entity: { eid: 'page' },
      doc: { title: 'Page' },
      claim: { session: 'native' },
    },
    {
      entity: { eid: 'note' },
      comment: { target: 'page' },
      doc: { body: 'please check' },
    },
    {
      entity: { eid: 'knock' },
      knock: { target: 'native' },
      doc: { body: 'child finished' },
    },
    {
      entity: { eid: 'letter' },
      mail: { from: 'a@example.com', to: 'b@example.com' },
      deliver: { to: 'outside' },
      doc: { title: 'A letter' },
    },
  ], { trusted: true })
  return g
}

test('native bus delivery appends input and marks the item once', async () => {
  let wakes: string[] = []
  let g = await fresh(undefined, (eid) => wakes.push(eid))
  wakes.length = 0
  assertEquals(await feed(g), 1)
  let entries = await g.read('.entry.session=native&*')
  assertEquals(entries.length, 2)
  assertEquals(
    (entries[1].content as { body: string }).body.includes('child finished'),
    true,
  )
  assertEquals(entries.slice(1).every((e) => !!e.attention), true)
  assertEquals(
    entries.slice(1).every((e) => wakes.includes(e.entity.eid)),
    true,
  )
  assertEquals((await g.get(['note']))[0].notified != null, false)
  assertEquals((await g.get(['knock']))[0].notified != null, true)
  assertEquals(await feed(g), 0)
  assertEquals((await g.read('.entry.session=native')).length, 2)
})

test('SQLite finds the same addressed comment and knock', async () => {
  let g = await fresh(lite())
  assertEquals(await feed(g), 1)
  assertEquals(
    (await g.get(['note', 'knock'])).map((b) => !!b.notified),
    [false, true],
  )
})

test('an outside caller receives what was addressed to its session once', async () => {
  let g = await fresh()
  let call = { entity: { eid: 'call' }, created: { via: 'outside' } }
  let first = await reply(g, call)
  assertEquals(first.length, 1)
  assertEquals(
    (first[0].content as { body: string }).body.includes('A letter'),
    true,
  )
  assertEquals((await g.get(['letter']))[0].notified != null, true)
  assertEquals(await reply(g, call), [])
})

// An outside session and a letter delivered to it, before its harness reports
// to the hook door and after.
let letter = (eid: string, title: string): Bundle => ({
  entity: { eid },
  mail: { from: 'a@example.com', to: 'b@example.com' },
  deliver: { to: 'outside' },
  doc: { title },
})
// Each listener owns a private graph. Its fixed history is admitted once,
// before the test calls the real hook and tool-reply doors. These outside
// callers have no native process, persona or project to listen on behalf of.
let words = (doc: VocabDoc, ...names: string[]): VocabDoc => ({
  $defs: Object.fromEntries(names.map((name) => [name, doc.$defs![name]])),
})
let hookVocab = loadVocab([
  words(kernelDoc, 'entity', 'created', 'updated'),
  words(docDoc, 'doc'),
  words(sessionDoc, 'session', 'hooked', 'entry', 'using'),
  words(mailDoc, 'mail', 'deliver', 'notified'),
])
let outside = (rows: Bundle[]) =>
  graph({
    vocab: hookVocab,
    storage: laid(rows, ram(hookVocab, { computed: statusComputed })),
  })
let POSTED = outside(
  await image([
    { entity: { eid: 'outside' }, session: { id: 'outside' } },
    letter('letter', 'A letter'),
  ]),
)
let HOOKED = outside(
  await image([
    { entity: { eid: 'outside' }, session: { id: 'outside' }, hooked: {} },
    letter('later', 'A later letter'),
  ]),
)
let fork = { session_id: 'outside', agent_id: 'fork' }
// Whether an item was said to the session it was for.
let said = async (g: Graph, eid: string) =>
  (await g.get([eid]))[0].notified != null

test('a session hears at its own hook, never through a subagent', async () => {
  let g = POSTED
  assertEquals(await heard(g, fork), {})
  assertEquals(await said(g, 'letter'), false)
  // a subagent's own tool reply, which wears the session's id, takes nothing
  let call = { entity: { eid: 'call' }, created: { via: 'outside' } }
  assertEquals(await reply(g, call), [])
  assertEquals(await said(g, 'letter'), false)
  let told = await heard(g, {
    session_id: 'outside',
    hook_event_name: 'PostToolUse',
  }) as { hookSpecificOutput: { additionalContext: string } }
  assertEquals(
    told.hookSpecificOutput.additionalContext.includes('A letter'),
    true,
  )
  assertEquals(await said(g, 'letter'), true)
  // and from then on it is a hooked session
  assertEquals(!!(await g.get(['outside']))[0].hooked, true)
})

test('a hooked session hears nothing through a tool reply, only at its hook', async () => {
  let g = HOOKED
  let call = { entity: { eid: 'call' }, created: { via: 'outside' } }
  assertEquals(await reply(g, call), [])
  assertEquals(await heard(g, fork), {})
  assertEquals(await said(g, 'later'), false)
  assertEquals(
    JSON.stringify(await heard(g, { session_id: 'outside' })).includes(
      'A later letter',
    ),
    true,
  )
})

test('the session duty delivers without a Claude transcript directory', async () => {
  let g = await fresh()
  let stop = new AbortController()
  let run = service({ graph: g }, { transcripts: '' }, stop.signal)
  try {
    await until(async () => (await g.get(['knock']))[0].notified)
    assertEquals((await g.read('.entry.session=native')).length, 2)
  } finally {
    stop.abort()
    await run
  }
})

test('native comments never feed through the bus; outside task claims retain their listener', async () => {
  let g = await fresh()
  await g.apply([
    {
      entity: { eid: 'direct' },
      comment: { target: 'outside' },
      doc: { body: 'direct words' },
    },
    {
      entity: { eid: 'task' },
      doc: { title: 'claimed' },
      claim: { session: 'outside' },
    },
    {
      entity: { eid: 'claimed-note' },
      comment: { target: 'task' },
      doc: { body: 'claimed words' },
    },
  ], { trusted: true })
  let first = await reply(g, {
    entity: { eid: 'call2' },
    created: { via: 'outside' },
  })
  assertEquals(first.length, 2) // letter and claimed comment, never direct comment
  assertEquals((await g.get(['direct']))[0].notified != null, false)
  assertEquals((await g.get(['claimed-note']))[0].notified != null, true)
  await feed(g)
  assertEquals((await g.get(['note']))[0].notified != null, false)
  assertEquals((await g.read('.entry.session=native')).length, 2)
})

test('a process-backed harness claim still hears comments with a using entry', async () => {
  let g = await fresh(lite())
  // The spawned runner's using entry is a request to its outside process; it
  // does not make the transcript native and deaf to claimed-work comments.
  await g.apply([
    { entity: { eid: 'outside' }, process: { pid: 1234 } },
    {
      entity: { eid: 'outside-start' },
      entry: { session: 'outside' },
      content: { body: 'outside start' },
      using: {},
    },
    {
      entity: { eid: 'outside-task' },
      claim: { session: 'outside' },
      doc: { title: 'task' },
    },
    {
      entity: { eid: 'outside-note' },
      comment: { target: 'outside-task' },
      doc: { body: 'person reply' },
    },
  ], { trusted: true })
  let lines = await reply(g, {
    entity: { eid: 'outside-call' },
    created: { via: 'outside' },
  })
  assertEquals(lines.length, 2)
  assertEquals((await g.get(['outside-note']))[0].notified != null, true)
  assertEquals((await g.read('.entry.session=outside')).length, 1)
})

// A letter a session wrote, and the far side's answer to it: the reply is
// that session's to hear, once, and waits unsaid while nobody hears it.
let correspond = async (g: Awaited<ReturnType<typeof fresh>>, by: string) => {
  await g.apply([{
    entity: { eid: `sent-${by}` },
    mail: { from: 'project@example.com', message_id: `sent-${by}@example` },
    deliver: { to: 'person' },
    doc: { title: 'A question' },
    $actor: { by: 'project', via: by },
  }])
  await g.apply([{
    entity: { eid: `answer-${by}` },
    mail: {
      from: 'person@example.com',
      to: 'project@example.com',
      reply_to: `sent-${by}`,
    },
    doc: { title: 'Re: A question', body: 'Yes, go ahead.' },
    $actor: { by: 'person' },
  }])
}

for (
  let [name, store] of [['RAM', memory], ['SQLite', lite]] as const
) {
  test(`${name}: a reply reaches the session that wrote the letter, once, and waits unheard`, async () => {
    let g = await fresh(store())
    await g.apply([
      { entity: { eid: 'gone' }, session: { id: 'gone' } },
      { entity: { eid: 'person' }, doc: { title: 'Person' } },
      { entity: { eid: 'project' }, doc: { title: 'Project' } },
    ], { trusted: true })
    for (let by of ['outside', 'native', 'gone']) await correspond(g, by)
    let call = { entity: { eid: 'call' }, created: { via: 'outside' } }
    let heard = await reply(g, call)
    assertEquals(
      heard.map((b) => (b.content as { body: string }).body)
        .filter((line) => line.includes('Yes, go ahead.')).length,
      1,
    )
    assertEquals(await said(g, 'answer-outside'), true)
    assertEquals(await feed(g), 2) // the knock, and the native session's reply
    let input = await g.read('.entry.session=native&*')
    assertEquals(
      input.some((e) =>
        (e.content as { body: string }).body.includes('Yes, go ahead.')
      ),
      true,
    )
    assertEquals(await said(g, 'answer-native'), true)
    // Nobody hears for a session that is not listening: its reply waits.
    assertEquals(await said(g, 'answer-gone'), false)
    assertEquals((await reply(g, call)).length, 0)
  })
}

// A project whose persona two native transcripts wear, one at work with a
// knock of its own and one at rest, and news held for the project.
let HELD = await image([
  { entity: { eid: 'p' }, project: {} },
  { entity: { eid: 'operator' }, persona: { home: 'p' } },
  {
    entity: { eid: 'native' },
    session: { id: 'native', persona: 'operator' },
  },
  {
    entity: { eid: 'start' },
    entry: { session: 'native' },
    content: { body: 'start' },
    using: {},
  },
  {
    entity: { eid: 'knock' },
    knock: { target: 'native' },
    doc: { body: 'child finished' },
  },
  { entity: { eid: 'resting' }, session: { persona: 'operator' } },
  {
    entity: { eid: 'asked' },
    entry: { session: 'resting' },
    content: { body: 'look into it' },
    using: {},
  },
  {
    entity: { eid: 'answered' },
    entry: { session: 'resting' },
    output: { source: 'asked' },
    content: { body: 'done' },
  },
  { entity: { eid: 'news' }, knock: { target: 'p' }, doc: { body: 'bug' } },
])

// This fixture holds knocks, not mail: keep the graph's real transcript and
// project rules without installing unrelated letter delivery paths.
let heldVocab = loadVocab([
  words(kernelDoc, 'entity', 'created', 'updated'),
  words(docDoc, 'doc'),
  words(notifyDoc, 'knock'),
  words(toolsDoc, 'content', 'output'),
  words(mailDoc, 'notified'),
  words(personaDoc, 'persona'),
  words(projectDoc, 'project'),
  words(sessionDoc, 'session', 'entry', 'using', 'claim'),
])
let held = graph({
  vocab: heldVocab,
  storage: laid(HELD, ram(heldVocab, { computed: statusComputed })),
})

test('RAM: what is held for a project is fed to its transcript at work, never one at rest', async () => {
  let g = held
  assertEquals(
    (await due(g)).map(({ session, item }) => [session, item.entity.eid]),
    [['native', 'knock'], ['native', 'news']],
  )
})

test('project-held news waits for a native turn, but addressed news never waits', async () => {
  let news = HELD.find((b) => b.entity.eid == 'news')!
  let knock = HELD.find((b) => b.entity.eid == 'knock')!
  let working = (session: string) =>
    ['pending', 'running'].includes(statusOf(
      HELD.filter((b) => (b.entry as { session?: string })?.session == session),
    ))
  let due: string[][] = []
  for (let session of ['native', 'resting']) {
    for (
      let item of await pendingItems(
        session,
        true,
        working(session),
        session == 'native' ? [knock] : [],
        () => [news],
      )
    ) due.push([session, item.entity.eid])
  }
  assertEquals(due, [['native', 'knock'], ['native', 'news']])
  // Rest only withholds project news, not a knock addressed to the transcript.
  let direct = { ...knock, knock: { target: 'resting' } }
  assertEquals(
    await pendingItems('resting', true, false, [direct], () => {
      throw new Error('a transcript at rest must not read project news')
    }),
    [direct],
  )
  // An outside listener hears held news on its own call, between turns too.
  assertEquals(await pendingItems('outside', false, false, [], () => [news]), [
    news,
  ])
})
