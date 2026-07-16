import { define } from '../utils.ts'
import { deps, open, type Task as Row, tasks } from '../db.ts'
import { Tasks } from '../components/Tasks.tsx'
import { Task } from '../components/Task.tsx'

// One handle for the server's lifetime — the graph is the memory substrate.
let db = open()

export default define.page(function Home() {
  let rows = tasks(db)
  let edges = deps(db)
  let name = new Map(rows.map((t: Row) => [t.eid, t.title]))
  let out = (eid: number) => edges.filter((d) => d.parent == eid)

  return (
    <main class='wrap'>
      <h1>
        Tasks v2 <span class='sub'>· the fleet entity graph</span>
      </h1>
      <Tasks>
        {rows.map((t: Row) => (
          <Task
            key={t.eid}
            task={t}
            edges={out(t.eid)}
            name={(eid) => name.get(eid) ?? `#${eid}`}
          />
        ))}
      </Tasks>
    </main>
  )
})
