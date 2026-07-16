import { type Ent } from '../../types.ts'
import { View } from '../View.tsx'

let cols = ['open', 'wip', 'done']

// A project as kanban: columns derived from task status. Nothing spatial is
// stored — the same children on a Canvas would read pins.
export let Board = ({ e }: { e: Ent }) => (
  <div class='Board'>
    {cols.map((s) => (
      <div class='Board_Col' key={s}>
        <div class='Board_ColName'>{s}</div>
        {e.kids.filter((k) => k.task?.status == s).map((k) => (
          <View key={k.eid} eid={k.eid} />
        ))}
      </div>
    ))}
  </div>
)
