// The task tile's compact identity line: project context travels with a task
// anywhere the shared list renderer appears.
import { type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { cache, ent } from '../../live.ts'
import { TaskTile } from './TaskTile.tsx'

let children = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat()
    .filter(Boolean) as VNode[]

Deno.test('task tile names its project', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      doc: { eid: 'project', title: 'Task Graph', body: '' },
      project: { eid: 'project' },
    },
    task: {
      entity: { eid: 'task', num: 2 },
      doc: { eid: 'task', title: 'Show project', body: '' },
      task: {
        eid: 'task',
        status: 'open',
        priority: 0,
        project_eid: 'project',
      },
    },
  }

  let meta = children(TaskTile({ e: ent('task') }))[2]
  let project = children(meta)[1]
  assertEquals(project.props.children, 'Task Graph')
})
