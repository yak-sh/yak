/** The inbox's money boundary through its real graph and native runner doors. */
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test, until } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Bundle, type Comp, derivedEid, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { running, transcript } from '@yaks/session'
import {
  answering,
  externalWords,
  inboxHandlers,
  reusable,
  threadPrompt,
} from './answering.ts'
import { at } from './testing.ts'

let c = (b: Bundle | undefined, name: string) => b?.[name] as Comp ?? {}
let fresh = async () => {
  let config = {
    ...at(),
    plugins: [...at().plugins!, '@yaks/inbox', '@yaks/mail'],
  }
  let host = await compose(config, ['graph'])
  await host.graph.apply([{
    entity: { eid: 'person' },
    person: {},
    doc: { title: 'Person' },
  }])
  return host
}
let input = (
  id: string,
  target?: string,
  by = 'person',
  via?: string,
): Bundle => ({
  entity: { eid: id },
  ...target ? { comment: { target } } : { conversation: {} },
  doc: { title: 'first line', body: id },
  $actor: { by, ...via ? { via } : {} },
})
let options = (holder: string) => ({
  person: 'person',
  holder,
  model: 'test-model',
  provider: 'test',
})

test('external authorship rejects system words independently of the person filter', async () => {
  let h = await fresh(), g = h.graph
  try {
    await g.apply([
      { entity: { eid: 'agent' }, session: { id: 'agent' } },
      {
        entity: { eid: 'effect-writer' },
        effect: { handler: 'no-op', state: 'done' },
      },
      { entity: { eid: 'other' }, person: {} },
    ], { trusted: true })
    let read = async (b: Bundle) => {
      await g.apply([b])
      return (await g.get([b.entity.eid]))[0]
    }
    assert(await externalWords(g, await read(input('outside'))))
    assert(
      await externalWords(
        g,
        await read(input('other-outside', undefined, 'other')),
      ),
    )
    assert(
      !await externalWords(
        g,
        await read(input('agent-words', undefined, 'agent')),
      ),
    )
    assert(
      !await externalWords(
        g,
        await read(input('agent-as-person', undefined, 'person', 'agent')),
      ),
    )
    assert(
      !await externalWords(
        g,
        await read(input('effect-words', undefined, 'person', 'effect-writer')),
      ),
      'effect row: ' +
        JSON.stringify(await g.get(['effect-writer', 'effect-words'])),
    )
    let api = answering(g, options(h.me))
    for (
      let id of [
        'agent-words',
        'agent-as-person',
        'effect-words',
        'other-outside',
      ]
    ) await api.accept(id)
    assertEquals((await g.read('.inbox_input')).length, 0)
    await api.accept('outside')
    assertEquals((await g.read('.inbox_input')).length, 1)
  } finally {
    await h.close()
  }
})

test('incoming envelope keeps outside authorship separate from current eligibility', async () => {
  let h = await fresh(), g = h.graph
  try {
    let api = answering(g, options(h.me))
    await g.apply([
      { entity: { eid: 'other' }, person: {} },
      { entity: { eid: 'system' }, session: { id: 'system' } },
      ...['person', 'other', 'system'].map((by) => ({
        ...input(`mail-${by}`, undefined, by),
        mail: {
          from: `${by}@example.test`,
          to: 'inbox@example.test',
          message_id: `mail-${by}`,
          verified: true,
        },
      })),
    ], { trusted: true })
    let [other, system] = await g.get(['mail-other', 'mail-system'])
    assert(await externalWords(g, other))
    assert(!await externalWords(g, system))
    for (let id of ['mail-person', 'mail-other', 'mail-system']) {
      await api.accept(id)
    }
    assertEquals((await g.read('.inbox_input')).length, 1)
    let [receipt] = await g.read('.inbox_input')
    assertEquals(c(receipt, 'inbox_input').message, 'mail-person')
  } finally {
    await h.close()
  }
})

test('routing commits one receipt on retries and uses a working session for a mid-turn reply', async () => {
  let h = await fresh(), g = h.graph
  try {
    let api = answering(g, options(h.me))
    await g.apply([input('conversation')])
    await Promise.all([api.accept('conversation'), api.accept('conversation')])
    await api.accept('conversation')
    assertEquals((await g.read('.session')).length, 1)
    let [initial] = await g.read('.inbox_input&?entry&?content')
    let session = String(c(initial, 'entry').session)
    assertStringIncludes(String(c(initial, 'content').body), 'conversation')
    await g.apply([input('during', 'conversation')])
    await api.accept('during')
    let [during] = await g.read('.inbox_input.message=during&?entry')
    assertEquals(c(during, 'entry').session, session)
    assertEquals((await g.read('.session')).length, 1)
    assertEquals(c((await g.get([session]))[0], 'session').operator, false)
    assertEquals((await g.read(`.answers&.edge.from=${session}`)).length, 1)
  } finally {
    await h.close()
  }
})

test('settled cache reuse is a model-window share and unknown observations start fresh', async () => {
  let h = await fresh(), g = h.graph
  try {
    let api = answering(g, { ...options(h.me), now: () => 1000 })
    await g.apply([input('conversation')])
    await api.accept('conversation')
    let [initial] = await g.read('.inbox_input&?entry')
    let session = String(c(initial, 'entry').session)
    let model = identityEid('model', ['test-model'])
    await g.apply([
      { entity: { eid: model }, model: { context: 1000 } },
      {
        entity: { eid: 'ask' },
        entry: { session },
        ask: { to: model, through: initial.entity.eid },
        openai: { cache_expires_at: new Date(10000).toISOString() },
        usage: { input_tokens: 100, output_tokens: 10 },
      },
      {
        entity: { eid: 'output' },
        entry: { session },
        output: { source: 'ask' },
        content: { body: 'answered' },
      },
    ])
    assert(await reusable(g, session, .25, 1000))
    assert(!await reusable(g, session, .10, 1000))
    assert(!await reusable(g, session, .25, 10000))
    await api.publish(session)
    await api.publish(session)
    assertEquals((await g.read('.comment')).length, 1)
    await api.accept(derivedEid(`inbox reply ${initial.entity.eid}`))
    assertEquals((await g.read('.session')).length, 1)
    await g.apply([input('warm', 'conversation')])
    await api.accept('warm')
    assertEquals((await g.read('.session')).length, 1)
    let [warm] = await g.read('.inbox_input.message=warm&?entry')
    assertEquals(c(warm, 'entry').session, session)
    await g.apply([
      {
        entity: { eid: 'ask2' },
        entry: { session },
        ask: { to: model, through: warm.entity.eid },
        usage: { input_tokens: 100, output_tokens: 10 },
      },
      {
        entity: { eid: 'output2' },
        entry: { session },
        output: { source: 'ask2' },
        content: { body: 'warm answer' },
      },
    ])
    assert(!await reusable(g, session, .25, 1000))
    await api.publish(session)
    await g.apply([input('cold', 'conversation')])
    await api.accept('cold')
    assertEquals((await g.read('.session')).length, 2)
    let [cold] = await g.read('.inbox_input.message=cold&?content')
    assertStringIncludes(String(c(cold, 'content').body), 'warm answer')
    assertStringIncludes(String(c(cold, 'content').body), 'cold')
  } finally {
    await h.close()
  }
})

test('whole-thread input includes letters from the shared discussion read', async () => {
  let h = await fresh(), g = h.graph
  try {
    await g.apply([
      input('thread'),
      {
        entity: { eid: 'letter' },
        mail: {
          target: 'thread',
          from: 'person@example.test',
          to: 'inbox@example.test',
          message_id: 'received',
        },
        doc: { body: 'Words that came by mail' },
        $actor: { by: 'person' },
      },
      input('comment', 'thread'),
    ])
    let prompt = await threadPrompt(g, 'thread', 'person')
    assertStringIncludes(prompt, 'Words that came by mail')
    assertStringIncludes(prompt, 'comment')
  } finally {
    await h.close()
  }
})

test('a running native task claim owns the reply rather than another session', async () => {
  let h = await fresh(), g = h.graph
  try {
    let api = answering(g, options(h.me))
    await g.apply([input('conversation')])
    await api.accept('conversation')
    let [i] = await g.read('.inbox_input&?entry')
    let session = String(c(i, 'entry').session)
    await g.apply([{
      entity: { eid: 'task' },
      task: {},
      claim: { session },
      doc: { body: 'claimed work' },
    }, input('task-reply', 'task')])
    await api.accept('task-reply')
    let [reply] = await g.read('.inbox_input.message=task-reply&?entry')
    assertEquals(c(reply, 'entry').session, session)
    assertEquals((await g.read('.session')).length, 1)
  } finally {
    await h.close()
  }
})

test('decision answer routes on blocked work with the answer as its newest words', async () => {
  let h = await fresh(), g = h.graph
  try {
    let api = answering(g, options(h.me))
    await g.apply([
      { entity: { eid: 'task' }, task: {}, doc: { body: 'blocked work' } },
      {
        entity: { eid: 'decision' },
        task: {},
        decision: {
          question: 'which?',
          choices: [{ label: 'a', description: 'A' }, {
            label: 'b',
            description: 'B',
          }],
          recommended: 'a',
        },
      },
      link('task', 'requires', 'decision'),
    ])
    await g.apply([{
      entity: { eid: 'decision' },
      decided: { choice: 'b' },
      $actor: { by: 'person' },
    }])
    await api.accept('decision')
    let [i] = await g.read('.inbox_input&?content')
    assertEquals(c(i, 'inbox_input').root, 'task')
    assertStringIncludes(String(c(i, 'content').body), 'Decision answer: b')
  } finally {
    await h.close()
  }
})

test('effects route external input, native runner settles and publishes without a feedback loop', async () => {
  let h = await fresh(), g = h.graph, stop = new AbortController()
  let requests = 0
  h.fx.handle({
    ...inboxHandlers(h, options(h.me)),
    ...running(g, {
      holder: h.me,
      model: (request) => {
        requests++
        return Promise.resolve({
          id: `reply-${requests}`,
          model: request.model,
          items: [{ kind: 'assistant', text: 'final answer' }],
        })
      },
      tools: [],
    }),
  })
  let work = h.fx.work(g, stop.signal)
  try {
    await g.apply([input('conversation')])
    await until(async () => (await g.read('.comment')).length == 1, {
      timeout: 10000,
      label: 'posted final answer',
    })
    let [comment] = await g.read('.comment&?created&?doc')
    assertEquals(c(comment, 'doc').body, 'final answer')
    assert(c(comment, 'created').by != 'person')
    await answering(g, options(h.me)).accept(comment.entity.eid)
    assertEquals(requests, 1)
    assertEquals((await g.read('.session')).length, 1)
    let [s] = await g.read('.session')
    assertEquals(
      (await transcript(g, s.entity.eid)).filter((b) => b.inbox_input).length,
      1,
    )
  } finally {
    stop.abort()
    await h.fx.stop()
    await work
    await h.close()
  }
})
