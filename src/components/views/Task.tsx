import { type Ent } from '../../types.ts'
import { Dot } from '../Dot.tsx'
import { View } from '../View.tsx'

// A single task: head, body, then its edges as Dependency sentences.
export let Task = ({ e }: { e: Ent }) => (
  <div class='Task'>
    <div class='Task_Head'>
      <Dot status={e.task!.status} />
      <span class='Task_Title'>{e.task!.title}</span>
      <View eid={e.eid} view='Id' />
    </div>
    {e.task!.body && <p class='Task_Body'>{e.task!.body}</p>}
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
  </div>
)
