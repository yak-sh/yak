// The runner lent a graph and nothing else: no shell, no checkout, no lock, no
// instruction files, no file of its own. What a Worker lends the agent is this
// much (D1 is the same SQL), and a transcript still runs to the end.
import { assertEquals, assertRejects } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { statusOf } from '@yaks/session'
import { agent } from './agent.ts'
import { harness } from './testing.ts'

let echo: Model = (req) =>
  Promise.resolve({
    id: 'r1',
    model: req.model,
    items: [{ kind: 'assistant', text: 'heard' }],
  })

let host = async () => {
  let { g, fx, vocab, me, close } = await harness()
  return { h: { g, fx, vocab, me }, release: close }
}

Deno.test('the runner needs a graph and a model, nothing of a machine', async () => {
  let { h, release } = await host()
  let released = false
  let a = agent({
    h,
    model: echo,
    release: () => {
      released = true
      release()
    },
  })
  let s = await a.start('ping')
  await a.idle(s)
  let entries = await a.transcript(s)
  assertEquals(statusOf(entries), 'settled')
  assertEquals(a.line(entries[0]).includes('ping'), true)
  await a.close()
  assertEquals(released, true)
  await assertRejects(() => a.send(s, 'again'), Error, 'Agent is closing')
})

Deno.test('what a caller says is signed with them, through the transcript', async () => {
  let { h, release } = await host()
  let a = agent({ h, model: echo, release })
  try {
    let [caller] = await h.g.apply([
      { entity: { eid: '$c' }, session: { id: 'caller' } },
    ])
    let by = caller.entity.eid
    let s = await a.start('ping', { by })
    await a.idle(s)
    await a.send(s, 'again', by)
    await a.idle(s)
    let said = (await a.transcript(s)).filter((b) => b.content && !b.output)
    assertEquals(
      said.map((b) => [(b.created as Comp).by, (b.created as Comp).via]),
      [[by, s], [by, s]],
    )
  } finally {
    await a.close()
  }
})

Deno.test('a new session opens with what its host found for it', async () => {
  let a = agent({
    ...await host(),
    model: echo,
    opening: () =>
      Promise.resolve({
        home: { cwd: '/work' },
        files: [{ body: 'be brief', source: '/work/AGENTS.md', revision: 'r' }],
      }),
  })
  let s = await a.start('ping')
  await a.idle(s)
  let [prompt, first] = await a.transcript(s)
  assertEquals(prompt.prompt, {
    scope: 'shared',
    source: '/work/AGENTS.md',
    revision: 'r',
  })
  assertEquals(first.content, { body: 'ping' })
  assertEquals(((await a.h.g.read('.session&*'))[0].home as Comp).cwd, '/work')
  await a.close(new Error('gone'))
  await assertRejects(() => a.start('pong'), Error, 'gone')
})
