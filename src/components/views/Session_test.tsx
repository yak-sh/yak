// A session row keeps the actor it works for visible in every shared list.
import { type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'

let children = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat()
    .filter(Boolean) as VNode[]

Deno.test('session row names its actor', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      doc: { eid: 'project', title: 'Task Graph', body: '' },
      project: { eid: 'project' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: {
        eid: 'session',
        id: 'session-id',
        actor_eid: 'project',
        model: 'gpt-5.6',
      },
    },
  }

  let e = ent('session')
  let row = resolve(e, 'List.Tile').Render({ e })!
  let actor = children(row)[2]
  assertEquals(actor.props.children, 'Task Graph')
})
