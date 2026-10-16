// Conversation behavior at the authenticated MCP door, using scratch in-memory
// graphs and fake native replies. No provider or live graph is contacted.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { textOf, transcript } from '@yaks/session'
import { working } from './testing.ts'

import { conversationFixture as fixture } from './conversations_testing.ts'

let opening = await fixture()
test('project conversations start immediately through MCP with exact input and separate server context', async () => {
  let { h, call, owner, project } = opening
  try {
    let projects = await call('conversation_projects')
    assertEquals(projects.owner, owner)
    assert(projects.projects.some((p: { id: string }) => p.id == project))
    let prompt = '  Exact owner words\nwith whitespace.  '
    let started = await call('conversation_start', { project, prompt })
    assertEquals(started.status, 'pending')
    let rows = await transcript(h.g, started.session)
    let inputs = rows.filter((b) => b.content && !b.prompt)
    assertEquals(inputs.length, 1)
    assertEquals(textOf(inputs[0]), prompt)
    assertEquals((inputs[0].created as Comp).by, owner)
    let context = rows.filter((b) => b.prompt).map(textOf).join('\n')
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
    let recent = await call('conversation_recent', { project })
    assertEquals(recent.conversations[0].session, started.session)
    assertEquals(recent.conversations[0].status, 'pending')
    // No runner was started: returning pending proves this door never waits
    // for a provider response.
  } finally {
    await h.close()
  }
})

let isolation = await fixture()
test('conversation ownership cannot be supplied, borrowed from an agent, or crossed between projects', async () => {
  let { h, run, call, request, project, elsewhere, owner, other } = isolation
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
    assertEquals(
      (await request('conversation_start', {
        project,
        prompt: 'forged',
        owner: other,
      })).isError,
      true,
    )
    assertEquals(
      (await request('conversation_read', {
        project: elsewhere,
        session: started.session,
      })).isError,
      true,
    )
    await assertRejects(
      () =>
        Promise.resolve(
          run.conversation_read!(
            bundle({ by: other }, { project, session: started.session }),
            h.g,
          ),
        ),
      Error,
      'not found',
    )
    let agent = crypto.randomUUID()
    await h.g.apply([{
      entity: { eid: agent },
      session: { id: agent, actor: owner, operator: false },
    }])
    for (
      let actor of [{}, { by: agent, via: agent }, { by: owner, via: agent }, {
        by: 'foreign-process',
        via: 'foreign-process',
      }]
    ) {
      await assertRejects(() =>
        Promise.resolve(run.conversation_projects!(bundle(actor, {}), h.g))
      )
    }
    // An actual human principal, with no agent instrument, is accepted too.
    let [out] = await run.conversation_projects!(bundle({ by: other }, {}), h.g)
    assertEquals(JSON.parse(textOf(out)).owner, other)
  } finally {
    await h.close()
  }
})

let reading = await fixture()
test('conversation read paginates all history and rereads progressive same-id replies without internal content', async () => {
  let { h, call, project } = reading
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
    assertEquals(tail.messages, [])
    let older = await call('conversation_read', {
      project,
      session,
      limit: 1,
      before: tail.nextBefore,
    })
    assertEquals(older.messages[0].text, 'grow')
    await h.g.apply([{
      entity: { eid: reply },
      content: { body: 'growing reply' },
    }])
    older = await call('conversation_read', {
      project,
      session,
      limit: 1,
      before: tail.nextBefore,
    })
    assertEquals(older.messages[0].id, reply)
    assertEquals(older.messages[0].text, 'growing reply')
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
    assertEquals(seen, ['first', 'growing reply'])
    await call('conversation_send', { project, session, text: '  follow up  ' })
    let all = await call('conversation_read', { project, session })
    assertEquals(all.messages.at(-1).text, '  follow up  ')
  } finally {
    await h.close()
  }
})

let native = await fixture()
test('conversation sends and reopens a real native transcript driven by a fake model', async () => {
  let { h, call, project } = native
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
    // The native effects test harness owns completion, not a polling timer.
    await done
    let page = await call('conversation_read', { project, session })
    assert(
      page.messages.some((m: { role: string; text: string }) =>
        m.role == 'assistant' && m.text == 'Native reply'
      ),
    )
    let inbox = await native.request('conversation_inbox')
    assertEquals(inbox.isError, undefined)
  } finally {
    await runner.stop()
    await h.close()
  }
})
