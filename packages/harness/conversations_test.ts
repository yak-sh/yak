// Drive each real MCP/native scenario on its own disposable graph before test
// registration, then assert immutable observations. Provider/HTTP/database work
// is fixture preparation, not part of the synchronous assertion budget.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { textOf, transcript } from '@yaks/session'
import { working } from './testing.ts'
import { conversationFixture as fixture } from './conversations_testing.ts'

// Detach observations from graph/runner state and freeze every nested value so
// a later fixture or assertion cannot revise what an earlier operation returned.
let frozen = <T>(value: T): T => {
  let freeze = (value: unknown): void => {
    if (value && typeof value == 'object') {
      for (let child of Object.values(value)) freeze(child)
      Object.freeze(value)
    }
  }
  let copy = structuredClone(value)
  freeze(copy)
  return copy
}
let rejection = async (action: () => unknown) => {
  try {
    await action()
    return { rejected: false, error: false, message: '' }
  } catch (error) {
    return {
      rejected: true,
      error: error instanceof Error,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

let opening = await (async () => {
  let { h, call, owner, project } = await fixture()
  try {
    let projects = await call('conversation_projects')
    let prompt = '  Exact owner words\nwith whitespace.  '
    let started = await call('conversation_start', { project, prompt })
    let rows = await transcript(h.g, started.session)
    let inputs = rows.filter((b) => b.content && !b.prompt)
    let recent = await call('conversation_recent', { project })
    return frozen({
      owner,
      project,
      projects,
      prompt,
      started,
      inputs: inputs.map((b) => ({
        text: textOf(b),
        by: (b.created as Comp).by,
      })),
      context: rows.filter((b) => b.prompt).map(textOf).join('\n'),
      recent,
    })
    // No runner was started: pending proves the door never waits for a model.
  } finally {
    await h.close()
  }
})()
test('project conversations start immediately through MCP with exact input and separate server context', () => {
  let { owner, project, projects, prompt, started, inputs, context, recent } =
    opening
  assertEquals(projects.owner, owner)
  assert(projects.projects.some((p: { id: string }) => p.id == project))
  assertEquals(started.status, 'pending')
  assertEquals(inputs.length, 1)
  assertEquals(inputs[0].text, prompt)
  assertEquals(inputs[0].by, owner)
  for (
    let text of [
      'Help this project gently.',
      'Make talking easy',
      'Recent probe work',
      'Owner across another door',
      'Imported human words',
    ]
  ) assert(context.includes(text), text)
  assert(!context.includes('Private elsewhere words'))
  assert(!context.includes('Agent is not owner'))
  assert(!context.includes('Model is not owner'))
  assertEquals(recent.conversations[0].session, started.session)
  assertEquals(recent.conversations[0].status, 'pending')
})

let isolation = await (async () => {
  let { h, run, call, request, project, elsewhere, owner, other } =
    await fixture()
  let bundle = (
    actor: { by?: string; via?: string },
    args: Record<string, unknown>,
  ): Bundle => ({
    entity: { eid: crypto.randomUUID() },
    call: { args },
    $actor: actor,
  })
  try {
    let started = await call('conversation_start', { project, prompt: 'hello' })
    let forged = await request('conversation_start', {
      project,
      prompt: 'forged',
      owner: other,
    })
    let crossed = await request('conversation_read', {
      project: elsewhere,
      session: started.session,
    })
    let otherOwner = await rejection(() =>
      run.conversation_read!(
        bundle({ by: other }, { project, session: started.session }),
        h.g,
      )
    )
    let agent = crypto.randomUUID()
    await h.g.apply([{
      entity: { eid: agent },
      session: { id: agent, actor: owner, operator: false },
    }])
    let denied = []
    for (
      let actor of [{}, { by: agent, via: agent }, { by: owner, via: agent }, {
        by: 'foreign-process',
        via: 'foreign-process',
      }]
    ) {
      denied.push(
        await rejection(() =>
          run.conversation_projects!(bundle(actor, {}), h.g)
        ),
      )
    }
    let [out] = await run.conversation_projects!(bundle({ by: other }, {}), h.g)
    return frozen({
      forged,
      crossed,
      otherOwner,
      denied,
      humanOwner: JSON.parse(textOf(out)).owner,
      other,
    })
  } finally {
    await h.close()
  }
})()
test('conversation ownership cannot be supplied, borrowed from an agent, or crossed between projects', () => {
  assertEquals(isolation.forged.isError, true)
  assertEquals(isolation.crossed.isError, true)
  assert(isolation.otherOwner.rejected)
  assert(isolation.otherOwner.error)
  assert(isolation.otherOwner.message.includes('not found'))
  assertEquals(isolation.denied.length, 4)
  for (let denied of isolation.denied) {
    assert(denied.rejected)
    assert(denied.error)
  }
  assertEquals(isolation.humanOwner, isolation.other)
})

let reading = await (async () => {
  let { h, call, project } = await fixture()
  try {
    let { session } = await call('conversation_start', {
      project,
      prompt: 'first',
    })
    let source = crypto.randomUUID(), reply = crypto.randomUUID()
    await h.g.apply([
      { entity: { eid: source }, entry: { session }, ask: { to: session } },
      {
        entity: { eid: reply },
        entry: { session },
        content: { body: 'grow' },
        output: { source },
      },
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        content: { body: 'hidden thought' },
        output: { source },
        reasoning: {},
      },
    ])
    let tail = await call('conversation_read', { project, session, limit: 1 })
    let older = frozen(
      await call('conversation_read', {
        project,
        session,
        limit: 1,
        before: tail.nextBefore,
      }),
    )
    await h.g.apply([{
      entity: { eid: reply },
      content: { body: 'growing reply' },
    }])
    let revised = await call('conversation_read', {
      project,
      session,
      limit: 1,
      before: tail.nextBefore,
    })
    let seen: string[] = []
    let before: number | undefined
    do {
      let page = await call('conversation_read', {
        project,
        session,
        limit: 2,
        ...before ? { before } : {},
      })
      seen.unshift(...page.messages.map((m: { text: string }) => m.text))
      before = page.nextBefore ?? undefined
    } while (before)
    await call('conversation_send', { project, session, text: '  follow up  ' })
    let all = await call('conversation_read', { project, session })
    return frozen({
      tail,
      older,
      revised,
      reply,
      seen,
      followup: all.messages.at(-1).text,
    })
  } finally {
    await h.close()
  }
})()
test('conversation read paginates all history and rereads progressive same-id replies without internal content', () => {
  assertEquals(reading.tail.messages, [])
  assertEquals(reading.older.messages[0].text, 'grow')
  assertEquals(reading.revised.messages[0].id, reading.reply)
  assertEquals(reading.revised.messages[0].text, 'growing reply')
  assertEquals(reading.seen, ['first', 'growing reply'])
  assertEquals(reading.followup, '  follow up  ')
})

let native = await (async () => {
  let { h, call, request, project } = await fixture()
  let resolve: (() => void) | undefined
  let done = new Promise<void>((yes) => resolve = yes)
  let runner = working(h, {
    tools: [],
    model: () =>
      Promise.resolve({
        id: crypto.randomUUID(),
        model: 'fake',
        items: [{ kind: 'assistant', text: 'Native reply' }],
      }),
    each: (step) => {
      if (step.status == 'settled') resolve?.()
    },
  })
  try {
    let { session } = await call('conversation_start', {
      project,
      prompt: 'talk',
    })
    // The real native runner owns completion, not a timer or a mock transcript.
    await done
    let page = await call('conversation_read', { project, session })
    let inbox = await request('conversation_inbox')
    return frozen({ page, inbox })
  } finally {
    await runner.stop()
    await h.close()
  }
})()
test('conversation sends and reopens a real native transcript driven by a fake model', () => {
  assert(
    native.page.messages.some((m: { role: string; text: string }) =>
      m.role == 'assistant' && m.text == 'Native reply'
    ),
  )
  assertEquals(native.inbox.isError, undefined)
})
