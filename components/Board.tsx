import { type Ent } from '../db.ts'
import { TaskView } from './Task.tsx'

let cols = ['open', 'wip', 'done']

// A project through the Board lens: kanban columns derived from task status.
// Nothing spatial is stored — the same children on a Canvas would read pins.
export let Board = ({ e }: { e: Ent }) => (
  <div class='Board'>
    {cols.map((s) => (
      <div class='Board_Col' key={s}>
        <div class='Board_ColName'>{s}</div>
        {e.kids.filter((k) => k.task?.status == s).map((k) => (
          <TaskView key={k.eid} e={k} />
        ))}
      </div>
    ))}
  </div>
)
