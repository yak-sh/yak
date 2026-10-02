import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { compose } from '@yaks/cli/host'
import type { Comp } from '@yaks/graph'
import { begin } from './agent.ts'
import { at, PLUGINS } from './testing.ts'

test('native openings distinguish people and their commands from automated callers', async () => {
  let h = await compose({ ...at(), plugins: [...PLUGINS, '@yaks/builders'] }, [
    'graph',
  ])
  try {
    await h.graph.apply([
      { entity: { eid: 'person' }, doc: { title: 'Ada' } },
      { entity: { eid: 'agent' }, session: { id: 'agent' } },
      { entity: { eid: 'effect' }, effect: {} },
      { entity: { eid: 'builder' }, builder: {} },
    ], { trusted: true })
    for (
      let [caller, operator] of [
        [{}, true],
        [{ by: 'person' }, true],
        [{ by: h.me, via: h.me }, true],
        [{ by: 'agent' }, false],
        [{ by: 'person', via: 'agent' }, false],
        [{ by: 'effect' }, false],
        [{ by: 'builder' }, false],
      ] as const
    ) {
      let id = await begin(h.graph, undefined, { using: {}, ...caller })
      let [session] = await h.graph.get([id], ['session', 'created'])
      assertEquals((session.session as Comp).operator, operator, String(caller))
      assertEquals((session.created as Comp).via, id)
    }
  } finally {
    await h.close()
  }
})
