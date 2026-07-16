import { type Dep, type Task as Row } from '../db.ts'
import { Dot } from './Dot.tsx'
import { Edge } from './Edge.tsx'

// One task as a card: a status dot, its title and short id, the body, then a
// tag per outgoing edge. `name` resolves an edge's target eid to its title.
export let Task = (
  { task, edges, name }: {
    task: Row
    edges: Dep[]
    name: (eid: number) => string
  },
) => (
  <li class='Task'>
    <div class='Task_Head'>
      <Dot status={task.status} />
      <span class='Task_Title'>{task.title}</span>
      <span class='Task_Id'>T-{task.eid}</span>
    </div>
    {task.body && <p class='Task_Body'>{task.body}</p>}
    {edges.map((d) => <Edge key={d.child} type={d.type} to={name(d.child)} />)}
  </li>
)
