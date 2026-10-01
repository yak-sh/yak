import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { local } from './local.ts'
import { runtimeAction, runtimeRows } from './runtime.ts'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { kernelDoc } from '@yaks/kernel/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { dispatchStatus } from '@yaks/session/admission'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import type { Agent } from './agent.ts'
import { elapsed } from './RuntimePanel.ts'
import { at, harness, repo, worker } from './testing.ts'

test('runtime cancellation preserves partial text, waits for new input, and resumes explicitly', async () => {
  let entered = Promise.withResolvers<void>()
  let calls = 0
  let a = local({
    cwd: repo(),
    h: await harness(),
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

test('runtime queued cancellation is scoped, and inspection does not schedule execution', async () => {
  let h = await harness()
  let calls = 0
  let a = local({
    cwd: repo(),
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
    let before = await h.g.read('.entry&*')
    assertEquals(
      (await runtimeRows(h.g, 'root')).map((b) => b.entity.eid).sort(),
      ['queued', 'root'],
    )
    assertEquals(await h.g.read('.entry&*'), before)
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
test('elapsed tolerates unknown clocks and does not display negative durations', () => {
  assertEquals(elapsed(undefined, 0), '')
  assertEquals(elapsed('1970-01-01T00:00:00Z', 62000), '1m 2s')
  assertEquals(elapsed('1970-01-01T00:00:02Z', 0), '0s')
})

test('runtime panel reads only while visible; navigation and feedback stay local', async () => {
  const { h: node } = await import('preact')
  const { mount } = await import('../tui/testing.ts')
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

test('worker runtime projection and scoped continuation use explicit commands', async () => {
  const { remote } = await import('./remote.ts')
  let connection = await remote({
    worker: worker(),
    config: at(':memory:'),
    cwd: repo(),
    fake: true,
  })
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

for (let legacy of [true, false]) {
  test(`runtime queued cancellation commits terminal entry and ${legacy ? 'legacy settlement' : 'dispatch removal'} together`, async () => {
    let vocab = loadVocab([kernelDoc, sessionDoc, toolsDoc])
    let g = graph({ vocab, storage: ram(vocab) })
    await g.apply([{
      entity: { eid: 'queued' },
      session: { id: 'queued' },
      dispatch: {
        ...(legacy ? { state: 'queued' } : {}),
        order: 1,
        args: '{}',
      },
    }], { trusted: true })
    let a = {
      h: { g } as Agent['h'],
      send: () => {
        throw new Error('cancellation must not send input')
      },
    }
    let observed: { status: unknown; stops: number; terminal: boolean }[] = []
    let refuse = true
    g.use({
      name: 'queued-cancellation-observer',
      hooks: {
        commit: (bundles) => {
          if (refuse && bundles.some((b) => b.stop)) {
            throw new Error('terminal entry refused')
          }
          return bundles
        },
        effect: async (bundles: Bundle[]) => {
          if (
            bundles.some((b) =>
              b.entity.eid == 'queued' ||
              (b.entry as Comp | undefined)?.session == 'queued'
            )
          ) {
            observed.push({
              status: dispatchStatus((await g.get(['queued']))[0]),
              stops: (await g.read('.entry.session=queued&.stop&*')).length,
              terminal: bundles.some((b) =>
                (b.entry as Comp | undefined)?.session == 'queued' && !!b.stop
              ),
            })
          }
          return bundles
        },
      },
    })
    // Refusing the terminal entry must not release the queue place either.
    await assertRejects(
      () => runtimeAction(a, 'queued', 'cancel-queued'),
      Error,
      'terminal entry refused',
    )
    assertEquals(dispatchStatus((await g.get(['queued']))[0]), 'queued')
    assertEquals(await g.read('.entry.session=queued&*'), [])
    assertEquals(observed, [])

    refuse = false
    assertMatch(await runtimeAction(a, 'queued', 'cancel-queued'), 'cancelled')
    assertEquals(observed, [{
      status: legacy ? 'settled' : null,
      stops: 1,
      terminal: true,
    }])
    let [row] = await g.get(['queued'])
    assertEquals(row.admitted, undefined)
    assertEquals(row.waiting, undefined)
    if (!legacy) assertEquals(row.dispatch, undefined)
    // Repeating a stale UI action cannot append another stop.
    await assertRejects(
      () => runtimeAction(a, 'queued', 'cancel-queued'),
      Error,
      'Only queued',
    )
    assertEquals((await g.read('.entry.session=queued&.stop&*')).length, 1)
  })
}
