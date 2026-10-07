import type { Comp } from '@yaks/graph'
// Ending a session is a graph fact, while an ordinary settled turn keeps its
// files. The lifecycle handler reaches the explicitly lent provider only.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { effects } from './effects.ts'
import { at } from './testing.ts'

test('declared lifecycle releases stopped machines without destroying settled-turn files', async () => {
  let host = await compose(at(), ['graph'], undefined, { install: true })
  let releases: unknown[] = []
  host.machines = {
    defaultProvider: 'fixture',
    providers: {
      fixture: {
        wake: () => Promise.reject(new Error('release never wakes')),
        release: (ref) => {
          releases.push(ref)
          return Promise.resolve()
        },
        export: async function* () {},
      },
    },
  }
  let handlers = effects(host)
  try {
    await host.graph.apply([
      {
        entity: { eid: 'm' },
        machine: { provider: 'fixture', address: '/kept', state: 'running' },
      },
      { entity: { eid: 's' }, session: {}, home: { machine: 'm' } },
      {
        entity: { eid: 'reply' },
        entry: { session: 's' },
        content: { body: 'done this turn' },
      },
    ])
    await handlers.session_machine_release(
      { entity: { eid: 'reply' } } as never,
      host.graph,
      {} as never,
      {} as never,
    )
    equal(releases, [])
    await host.graph.apply([{
      entity: { eid: 'stop-entry' },
      entry: { session: 's' },
      stop: {},
    }])
    await handlers.session_machine_release(
      { entity: { eid: 'stop-entry' } } as never,
      host.graph,
      {} as never,
      {} as never,
    )
    equal(releases, [{ id: 'm', address: '/kept' }])
    equal(((await host.graph.get(['m']))[0].machine as Comp).state, 'released')
    await host.graph.apply([
      {
        entity: { eid: 'task-machine' },
        machine: { provider: 'fixture', state: 'running' },
      },
      {
        entity: { eid: 'worker' },
        session: {},
        home: { machine: 'task-machine' },
      },
      {
        entity: { eid: 'task' },
        task: {},
        claim: { session: 'worker' },
        completed: {},
      },
    ])
    await handlers.session_machine_release(
      { entity: { eid: 'task' } } as never,
      host.graph,
      {} as never,
    )
    equal(releases.length, 1) // no reply yet: a completed task cannot kill a working session
    await host.graph.apply([{
      entity: { eid: 'worker-reply' },
      entry: { session: 'worker' },
      content: { body: 'finished' },
      output: { source: 'worker-reply' },
    }])
    await handlers.session_machine_release(
      { entity: { eid: 'worker-reply' } } as never,
      host.graph,
      {} as never,
    )
    equal(releases, [{ id: 'm', address: '/kept' }, { id: 'task-machine' }])
  } finally {
    await host.close()
  }
})
