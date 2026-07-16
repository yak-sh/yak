import { type Ent } from '../db.ts'
import { Dot } from './Dot.tsx'
import { Edge } from './Edge.tsx'

// A single task through the Task lens: head, body, edge sentences.
export let TaskView = ({ e }: { e: Ent }) => (
  <div class='Task'>
    <div class='Task_Head'>
      <Dot status={e.task!.status} />
      <span class='Task_Title'>{e.task!.title}</span>
      <span class='Task_Id'>T-{e.eid}</span>
    </div>
    {e.task!.body && <p class='Task_Body'>{e.task!.body}</p>}
    {e.refs.map((r) => <Edge key={r.child} type={r.type} to={r.name} />)}
  </div>
)
