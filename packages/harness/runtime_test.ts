import { assert, assertEquals, assertRejects } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'
import { runtimeRows } from './runtime.ts'
import { elapsed } from './RuntimePanel.ts'

Deno.test('runtime cancellation preserves partial text, waits for new input, and resumes explicitly', async () => {
  let entered = Promise.withResolvers<void>()
  let calls = 0
  let a = agent({
    h: open(':memory:'),
    name: 'fake',
    streaming: true,
    model: async (req) => {
      calls++
      if (calls == 1) {
        req.onText?.({ index: 0, text: 'partial' })
        entered.resolve()
        await new Promise<void>((_resolve, reject) => {
          req.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          )
        })
      }
      return {
        id: 'response',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'continued' }],
      }
    },
  })
  try {
    let id = await a.start('work')
    await entered.promise
    let rows = await a.runtime(id)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].attempt, { state: 'inflight' })
    assertMatch(await a.control(id, 'interrupt'), 'Cancellation requested')
    await a.idle(id)
    let entries = await a.transcript(id)
    assert(
      entries.some((b) => (b.content as { body?: string })?.body == 'partial'),
    )
    assert(
      entries.some((b) =>
        (b.error as { code?: string })?.code == 'interrupted'
      ),
    )
    assert(!entries.some((b) => b.exception))
    assertEquals(calls, 1)
    assertMatch(await a.control(id, 'resume'), 'Continuation input')
    await a.idle(id)
    assertEquals(calls, 2)
  } finally {
    await a.close()
  }
})
let assertMatch = (value: string, part: string) =>
  assert(value.includes(part), value)

Deno.test('runtime queued cancellation is scoped, and inspection does not schedule execution', async () => {
  let h = open(':memory:')
  let calls = 0
  let a = agent({
    h,
    maxChildren: 0,
    name: 'fake',
    model: () => {
      calls++
      return Promise.resolve({ id: 'r', model: 'fake', items: [] })
    },
  })
  try {
    await h.g.apply([
      { entity: { eid: 'root' }, session: { id: 'root' } },
      {
        entity: { eid: 'queued' },
        session: { id: 'queued' },
        spawned: { parent: 'root' },
        dispatch: { state: 'queued', order: 1, args: '{}' },
      },
      { entity: { eid: 'other' }, session: { id: 'other' } },
    ])
    let before = await h.g.read('.entry')
    assertEquals(
      (await runtimeRows(h.g, 'root')).map((b) => b.entity.eid).sort(),
      ['queued', 'root'],
    )
    assertEquals(await h.g.read('.entry'), before)
    assertMatch(await a.control('queued', 'cancel-queued'), 'cancelled')
    assertEquals((await a.transcript('queued')).at(-1)?.stop, {})
    assertEquals(calls, 0)
    await assertRejects(
      () => a.control('other', 'cancel-queued'),
      Error,
      'Only queued',
    )
  } finally {
    await a.close()
  }
})
Deno.test('elapsed tolerates unknown clocks and does not display negative durations', () => {
  assertEquals(elapsed(undefined, 0), '')
  assertEquals(elapsed('1970-01-01T00:00:00Z', 62000), '1m 2s')
  assertEquals(elapsed('1970-01-01T00:00:02Z', 0), '0s')
})

Deno.test('runtime panel reads only while visible; navigation and feedback stay local', async () => {
  const { h: node } = await import('preact')
  const { mount } = await import('../tui/harness.ts')
  const { frontend } = await import('./frontend.ts')
  const { RuntimePanel } = await import('./RuntimePanel.ts')
  const { Keyboard } = await import('./keyboard.ts')
  let ui = frontend(), reads = 0
  let observer: (() => void) | undefined
  let actions: string[] = []
  let fake = {
    runtime: () => {
      reads++
      return Promise.resolve([
        {
          entity: { eid: 'one' },
          session: { id: 'one', status: 'running' },
          attempt: { state: 'inflight' },
        },
        {
          entity: { eid: 'two' },
          session: { id: 'two', status: 'queued' },
          dispatch: { state: 'queued' },
        },
      ])
    },
    control: (id: string, action: string) => {
      actions.push(id + ':' + action)
      return Promise.resolve('accepted')
    },
  } as unknown as import('./panels.ts').UIAgent
  let screen = await mount(
    () =>
      node(
        'div',
        { col: '1' },
        node(Keyboard, { ui, action: () => false }),
        node(RuntimePanel, {
          ui,
          agent: fake,
          session: 'one',
          subscribe: (fn: () => void) => {
            observer = fn
            return () => {
              observer = undefined
            }
          },
        }),
      ),
    100,
    20,
  )
  try {
    assertEquals(reads, 0)
    await screen.send('\x1b')
    await screen.send('r')
    await screen.send('')
    assertEquals(reads, 1)
    assert(screen.text().includes('generating'), screen.text())
    await screen.send('j')
    await screen.send('x')
    await screen.send('')
    assertEquals(actions, ['two:cancel-queued'])
    assertEquals(reads, 1)
    observer?.()
    await screen.send('')
    assertEquals(reads, 1) // domain changes wait for the coalescing clock
    await screen.send('\x1b')
    assertEquals(observer, undefined)
    assert(!screen.text().includes('Runtime ·'))
  } finally {
    screen.free()
    await ui.close()
  }
})

Deno.test('worker runtime projection and scoped continuation use explicit commands', async () => {
  const { remote } = await import('./remote.ts')
  let connection = await remote({ db: ':memory:', fake: true })
  try {
    let id = await connection.agent.start('runtime worker fixture')
    await connection.idle(id)
    let rows = await connection.agent.runtime!(id)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].entity.eid, id)
    assertMatch(
      await connection.agent.control!(id, 'interrupt'),
      'No cancellable',
    )
    assertMatch(
      await connection.agent.control!(id, 'resume'),
      'Continuation input',
    )
    await connection.idle(id)
  } finally {
    await connection.close()
  }
})
