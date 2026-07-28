// The task tile's compact identity line: project context travels with a task
// anywhere the shared list renderer appears.
import { type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { type Ent } from '../../types.ts'
import { cache, ent } from '../../live.ts'
import { TaskTile } from './TaskTile.tsx'

// raw keeps what the renderer would actually paint — including the falsy
// values a guard leaked; children is the convenient element-only view.
let raw = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat()

let children = (v: VNode) => raw(v).filter(Boolean) as VNode[]

let meta = (e: Ent) => children(TaskTile({ e }))[2]

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

  let project = children(meta(ent('task')))[1]
  assertEquals(project.props.children, 'Task Graph')
})

// A tally guarded with `count &&` yields 0, which Preact paints as a digit.
Deno.test('task tile paints no tally it has nothing to count', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Nothing tallied', body: '' },
      task: { eid: 'task', status: 'open', priority: 0 },
    },
  }

  assertEquals(raw(meta(ent('task'))).filter((c) => typeof c == 'number'), [])
})
